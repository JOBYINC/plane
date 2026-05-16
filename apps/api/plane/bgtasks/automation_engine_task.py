# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Automation Engine — event-driven rule evaluation and execution.

Architecture
------------
1. `dispatch_automation_for_activities(activities)` is called inline from
   `issue_activities_task.issue_activity` right after IssueActivity rows are
   bulk_create'd. Same hook point as `dispatch_lark_for_activities`.
2. For each activity row, we map (field, verb) -> AutomationTriggerType,
   look up active rules in the project that subscribe to that trigger, and
   spawn `evaluate_and_execute_rule_task.delay(rule_id, issue_id, ctx)` per
   matching rule.
3. `evaluate_and_execute_rule_task` loads the rule + issue, evaluates the
   `conditions` predicate list, and executes the `actions` list one by one.
   Every run lands an `AutomationRuleRun` audit row.

Loop prevention
---------------
Engine-triggered mutations create an `IssueActivity` row DIRECTLY (we do
not go back through `issue_activity.delay`). dispatch_automation only
runs from inside `issue_activity`, so engine-created activity rows are
quarantined from the re-dispatch path by construction. A 5-minute Redis
dedup per (rule, issue) acts as belt-and-braces against pathological
config (e.g. two rules toggling each other's state).

Best-effort
-----------
Every action is wrapped in its own try/except. A failing action records
an `error` run and continues to the next; it never breaks the
originating HTTP request or stops sibling rules from firing.
"""

# Python imports
import logging
import time

# Third party
from celery import shared_task

# Django
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger("plane.bgtasks.automation_engine_task")

# Per-(rule, issue) dedup window. Long enough to absorb the "two rules
# ping-ponging each other" failure mode, short enough that legitimate
# "rule fires twice in an hour" use cases still work.
DEDUP_TTL_SECONDS = 5 * 60


# ---------------------------------------------------------------------------
# Trigger mapping: IssueActivity row -> AutomationTriggerType
# ---------------------------------------------------------------------------

_FIELD_TO_TRIGGER = {
    "state": "state_changed",
    "priority": "priority_changed",
    "target_date": "target_date_changed",
    "labels": "labels_changed",
}


def _activity_to_trigger_type(activity):
    """Return the trigger_type this IssueActivity fires, or None."""
    field = (getattr(activity, "field", "") or "").strip()
    verb = (getattr(activity, "verb", "") or "").strip()

    if field == "assignees":
        if getattr(activity, "new_identifier", None):
            return "assignee_added"
        if getattr(activity, "old_identifier", None):
            return "assignee_removed"
        return None

    if field == "comment" and verb == "created":
        return "comment_added"

    return _FIELD_TO_TRIGGER.get(field)


# ---------------------------------------------------------------------------
# Public entry point: dispatch from issue_activities_task
# ---------------------------------------------------------------------------


def dispatch_automation_for_activities(activities):
    """Fan out rule evaluations based on freshly-created activity rows.

    Mirrors `dispatch_lark_for_activities`: inline, best-effort,
    exceptions swallowed. Called from `issue_activities_task.issue_activity`
    immediately after `IssueActivity.objects.bulk_create`.
    """
    if not activities:
        return

    # Late import: keep Celery's task discovery cheap and avoid circular
    # imports during model setup.
    from plane.db.models import AutomationRule

    # Group activities by (project_id, trigger_type) so we hit the
    # rules table once per group, not once per activity.
    grouped = {}
    for activity in activities:
        trigger = _activity_to_trigger_type(activity)
        if not trigger:
            continue
        issue_id = getattr(activity, "issue_id", None)
        project_id = getattr(activity, "project_id", None)
        if not issue_id or not project_id:
            continue
        grouped.setdefault((project_id, trigger), []).append(activity)

    if not grouped:
        return

    for (project_id, trigger_type), acts in grouped.items():
        try:
            rule_ids = list(
                AutomationRule.objects.filter(
                    project_id=project_id,
                    trigger_type=trigger_type,
                    is_active=True,
                    deleted_at__isnull=True,
                ).values_list("id", flat=True)
            )
            if not rule_ids:
                continue

            for activity in acts:
                issue_id = str(activity.issue_id)
                ctx = {
                    "trigger_type": trigger_type,
                    "field": activity.field,
                    "verb": activity.verb,
                    "old_value": activity.old_value,
                    "new_value": activity.new_value,
                    "old_identifier": str(activity.old_identifier) if activity.old_identifier else None,
                    "new_identifier": str(activity.new_identifier) if activity.new_identifier else None,
                    "actor_id": str(activity.actor_id) if activity.actor_id else None,
                    "activity_id": str(activity.id),
                }
                for rule_id in rule_ids:
                    evaluate_and_execute_rule_task.delay(str(rule_id), issue_id, ctx)
        except Exception as exc:
            logger.exception(
                "dispatch_automation_for_activities: group failed", exc_info=exc
            )

    # Second pass: target_date changes should also fire any active
    # `due_soon` rules in the project scoped to the changed issue. This
    # bridges the gap between event-driven triggers (which only fire on
    # field-matching activity rows) and the scheduled `due_soon` trigger
    # (which would otherwise wait up to 60 minutes for the next beat).
    _kick_due_soon_for_target_date_changes(activities)


def _kick_due_soon_for_target_date_changes(activities):
    """When an issue's target_date is set/changed (including via the
    initial create, which only emits a verb='created' row rather than a
    field-specific one), immediately evaluate every active `due_soon`
    rule in that project against that one issue, if the new target_date
    falls inside the rule's window.

    Best-effort: any failure here logs and continues so it never blocks
    the originating issue write.
    """
    from datetime import date as _date, timedelta as _td

    from plane.db.models import AutomationRule, Issue, StateGroup

    by_project = {}
    for a in activities:
        field = (getattr(a, "field", "") or "").strip()
        verb = (getattr(a, "verb", "") or "").strip()
        if not a.project_id or not a.issue_id:
            continue
        # Two signals worth re-evaluating due_soon against:
        #   1. field=target_date update (the obvious case)
        #   2. verb=created (issue may have been created with a date
        #      already set; we check on the Issue row below)
        if field == "target_date" or verb == "created":
            by_project.setdefault(a.project_id, set()).add(a.issue_id)
    if not by_project:
        return

    today = _date.today()
    for project_id, issue_ids in by_project.items():
        try:
            due_soon_rules = list(
                AutomationRule.objects.filter(
                    project_id=project_id,
                    trigger_type="due_soon",
                    is_active=True,
                    deleted_at__isnull=True,
                )
            )
            if not due_soon_rules:
                continue
            issues = (
                Issue.issue_objects.select_related("state", "workspace", "project")
                .prefetch_related("assignees", "labels")
                .filter(id__in=issue_ids)
                .exclude(
                    state__group__in=[
                        StateGroup.COMPLETED.value,
                        StateGroup.CANCELLED.value,
                    ]
                )
            )
            for issue in issues:
                if issue.target_date is None or issue.target_date < today:
                    continue
                for rule in due_soon_rules:
                    days_before = int((rule.trigger_config or {}).get("days_before", 7))
                    if today <= issue.target_date <= today + _td(days=days_before):
                        evaluate_and_execute_rule_task.delay(
                            str(rule.id),
                            str(issue.id),
                            {
                                "trigger_type": "due_soon",
                                "via": "target_date_changed",
                                "days_before": days_before,
                            },
                            True,  # bypass_dedup so re-saving target_date re-fires
                        )
        except Exception as exc:
            logger.exception(
                "dispatch_automation_for_activities: due_soon kick failed", exc_info=exc
            )


# ---------------------------------------------------------------------------
# Condition evaluator
# ---------------------------------------------------------------------------


def _get_issue_field(issue, field):
    """Resolve a `conditions[].field` token against an Issue instance."""
    if field == "priority":
        return issue.priority
    if field == "state":
        return str(issue.state_id) if issue.state_id else None
    if field == "state_group":
        return issue.state.group if issue.state_id else None
    if field == "assignee_ids":
        return [str(a) for a in issue.assignees.values_list("id", flat=True)]
    if field == "label_ids":
        return [str(label_id) for label_id in issue.labels.values_list("id", flat=True)]
    if field == "target_date":
        return issue.target_date.isoformat() if issue.target_date else None
    if field == "start_date":
        return issue.start_date.isoformat() if issue.start_date else None
    if field == "sequence_id":
        return issue.sequence_id
    return None


def _evaluate_condition(issue, predicate):
    """Return True iff the predicate matches the issue.

    Predicate shape: {"field": "<name>", "op": "<operator>", "value": <any>}
    """
    field = predicate.get("field")
    op = predicate.get("op")
    expected = predicate.get("value")
    actual = _get_issue_field(issue, field)

    if op == "eq":
        return actual == expected
    if op == "ne":
        return actual != expected
    if op == "in":
        if isinstance(actual, list):
            return any(item in expected for item in actual)
        return actual in expected
    if op == "not_in":
        if isinstance(actual, list):
            return not any(item in expected for item in actual)
        return actual not in expected
    if op == "gt":
        return actual is not None and actual > expected
    if op == "lt":
        return actual is not None and actual < expected
    if op == "contains":
        return actual is not None and expected in actual
    if op == "is_null":
        return actual is None or actual == []
    if op == "is_not_null":
        return actual is not None and actual != []
    logger.warning("automation: unknown condition op %r", op)
    return False


def _conditions_match(issue, conditions):
    """All predicates must pass (AND). Empty list = always pass."""
    if not conditions:
        return True
    return all(_evaluate_condition(issue, p) for p in conditions)


# ---------------------------------------------------------------------------
# Action executors
# ---------------------------------------------------------------------------


def _resolve_state(project_id, config):
    """Resolve a `set_state` action config to a concrete State instance."""
    from plane.db.models import State

    state_id = config.get("state_id")
    if state_id:
        return State.all_state_objects.filter(
            id=state_id, project_id=project_id, deleted_at__isnull=True
        ).first()
    group = config.get("state_group")
    if group:
        return (
            State.all_state_objects.filter(
                project_id=project_id, group=group, deleted_at__isnull=True
            )
            .order_by("sequence")
            .first()
        )
    return None


def _record_activity(
    issue,
    field,
    old_value,
    new_value,
    old_identifier=None,
    new_identifier=None,
    comment=None,
):
    """Write an IssueActivity row directly (no .delay) for engine actions.

    Going through issue_activity.delay would re-trigger
    dispatch_automation on the same row and create an infinite loop.
    The audit log is still populated -- just without email / Lark fan-out,
    which is the correct behaviour for system-driven changes (use the
    `notify_lark` action if you want a DM).
    """
    from plane.db.models import IssueActivity

    IssueActivity.objects.create(
        issue_id=issue.id,
        project_id=issue.project_id,
        workspace_id=issue.workspace_id,
        actor=None,  # marks as system / automation
        verb="updated",
        field=field,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
        old_identifier=old_identifier,
        new_identifier=new_identifier,
        comment=comment or "Automation rule fired",
        epoch=int(time.time() * 1000),
    )


def _action_set_state(rule, issue, config):
    target_state = _resolve_state(issue.project_id, config)
    if target_state is None:
        return {"ok": False, "reason": "state_not_found", "config": config}
    if issue.state_id == target_state.id:
        return {"ok": True, "noop": True}
    old_state_id = str(issue.state_id) if issue.state_id else None
    issue.state = target_state
    issue.save(update_fields=["state", "updated_at"])
    _record_activity(
        issue,
        field="state",
        old_value=None,
        new_value=target_state.name,
        old_identifier=old_state_id,
        new_identifier=str(target_state.id),
        comment=f"Automation rule '{rule.name}' moved state",
    )
    return {"ok": True, "to_state": str(target_state.id)}


def _action_set_priority(rule, issue, config):
    new_priority = config.get("priority")
    valid = {p[0] for p in issue.PRIORITY_CHOICES}
    if new_priority not in valid:
        return {"ok": False, "reason": "invalid_priority", "config": config}
    if issue.priority == new_priority:
        return {"ok": True, "noop": True}
    old_priority = issue.priority
    issue.priority = new_priority
    issue.save(update_fields=["priority", "updated_at"])
    _record_activity(
        issue,
        field="priority",
        old_value=old_priority,
        new_value=new_priority,
        comment=f"Automation rule '{rule.name}' set priority",
    )
    return {"ok": True, "from": old_priority, "to": new_priority}


def _action_add_assignee(rule, issue, config):
    from plane.db.models import IssueAssignee, User

    user_id = config.get("user_id")
    if not user_id:
        return {"ok": False, "reason": "missing_user_id"}
    user = User.objects.filter(id=user_id).first()
    if not user:
        return {"ok": False, "reason": "user_not_found", "user_id": user_id}
    exists = IssueAssignee.objects.filter(
        issue=issue, assignee=user, deleted_at__isnull=True
    ).exists()
    if exists:
        return {"ok": True, "noop": True}
    IssueAssignee.objects.create(
        issue=issue,
        assignee=user,
        project_id=issue.project_id,
        workspace_id=issue.workspace_id,
    )
    _record_activity(
        issue,
        field="assignees",
        old_value=None,
        new_value=user.display_name or user.email,
        new_identifier=str(user.id),
        comment=f"Automation rule '{rule.name}' added assignee",
    )
    return {"ok": True, "assignee_id": str(user.id)}


def _action_notify_lark(rule, issue, config):
    """Fire a Lark DM. Reuses card_issue_assigned as a generic 'something
    happened' card. v2 can add a dedicated automation card."""
    from plane.utils.lark_notify import (
        get_union_id,
        send_interactive_card,
        card_issue_assigned,
    )
    from plane.utils.lark_i18n import user_lang

    from plane.db.models import User

    def _resolve_creator():
        if issue.created_by_id:
            u = User.objects.filter(id=issue.created_by_id).first()
            return [u] if u else []
        return []

    to_spec = (config.get("to") or "assignees").strip()
    recipients = []
    if to_spec == "assignees":
        recipients = list(issue.assignees.all())
        # Fallback: if the rule says "DM assignees" but the issue is
        # unassigned, surface to the creator so nothing falls silently.
        if not recipients:
            recipients = _resolve_creator()
    elif to_spec == "creator":
        recipients = _resolve_creator()
    elif to_spec.startswith("user_id:"):
        uid = to_spec.split(":", 1)[1]
        u = User.objects.filter(id=uid).first()
        if u:
            recipients = [u]

    if not recipients:
        return {"ok": False, "reason": "no_recipients"}

    # The card builders treat the second arg as a name string used in the
    # DM headline ("X assigned you to ..."). For automation-fired DMs we
    # pass the rule name as the "actor" so the recipient knows it came
    # from a rule, not a human.
    actor_name = f"Automation: {rule.name}"
    delivered = 0
    delivery_errors = []
    for user in recipients:
        union_id = get_union_id(user)
        if not union_id:
            delivery_errors.append({"user_id": str(user.id), "reason": "no_union_id"})
            continue
        try:
            card = card_issue_assigned(issue, actor_name, lang=user_lang(user))
            send_interactive_card(union_id, card)
            delivered += 1
        except Exception as exc:
            logger.exception("notify_lark: send failed", exc_info=exc)
            delivery_errors.append({"user_id": str(user.id), "reason": str(exc)[:200]})
    return {
        "ok": delivered > 0,
        "delivered": delivered,
        "recipients": len(recipients),
        "errors": delivery_errors or None,
    }


# Registry of supported actions -- look up by `action["type"]`.
_ACTIONS = {
    "set_state": _action_set_state,
    "set_priority": _action_set_priority,
    "add_assignee": _action_add_assignee,
    "notify_lark": _action_notify_lark,
}


def get_action_registry():
    """Public accessor so the scheduled-task module can reuse the same
    action handlers without duplicating the registry."""
    return _ACTIONS


# ---------------------------------------------------------------------------
# Celery task: evaluate one rule against one issue
# ---------------------------------------------------------------------------


def _dedup_key(rule_id, issue_id):
    return f"automation:rule:{rule_id}:issue:{issue_id}"


def execute_rule_on_issue(rule, issue, ctx=None, bypass_dedup=False):
    """Inner implementation, callable both from the Celery task wrapper
    below and from the scheduled-task module (Phase 3).

    Returns the chosen AutomationRuleRun.RunStatus value.

    `bypass_dedup=True` is used by the viewset's "kick after save" path
    so a freshly-saved rule re-evaluates issues even if they're still
    inside the 5-minute dedup window from a recent beat-driven run.
    """
    from plane.db.models import AutomationRuleRun

    ctx = ctx or {}

    dedup_key = _dedup_key(str(rule.id), str(issue.id))
    if not bypass_dedup and cache.get(dedup_key):
        AutomationRuleRun.objects.create(
            rule=rule,
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            status=AutomationRuleRun.RunStatus.SKIPPED_DEDUP,
            detail={"trigger_context": ctx},
        )
        return AutomationRuleRun.RunStatus.SKIPPED_DEDUP
    cache.set(dedup_key, "1", DEDUP_TTL_SECONDS)

    try:
        if not _conditions_match(issue, rule.conditions or []):
            AutomationRuleRun.objects.create(
                rule=rule,
                issue=issue,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                status=AutomationRuleRun.RunStatus.SKIPPED_CONDITION,
                detail={"trigger_context": ctx, "conditions": rule.conditions},
            )
            return AutomationRuleRun.RunStatus.SKIPPED_CONDITION
    except Exception as exc:
        logger.exception("automation: condition eval crashed", exc_info=exc)
        AutomationRuleRun.objects.create(
            rule=rule,
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            status=AutomationRuleRun.RunStatus.ERROR,
            detail={"trigger_context": ctx, "error": str(exc), "phase": "conditions"},
        )
        return AutomationRuleRun.RunStatus.ERROR

    # Execute each action under one transaction so a partial failure
    # rolls back model mutations from the failing action but lets the
    # outer best-effort logic still log a run row.
    action_results = []
    overall_status = AutomationRuleRun.RunStatus.SUCCESS
    with transaction.atomic():
        for idx, action in enumerate(rule.actions or []):
            action_type = action.get("type")
            handler = _ACTIONS.get(action_type)
            if not handler:
                action_results.append(
                    {"idx": idx, "type": action_type, "ok": False, "reason": "unknown_action_type"}
                )
                overall_status = AutomationRuleRun.RunStatus.ERROR
                continue
            try:
                # Re-fetch so a later action sees the prior action's mutation.
                issue.refresh_from_db()
                result = handler(rule, issue, action.get("config") or {})
                action_results.append({"idx": idx, "type": action_type, **result})
                if not result.get("ok"):
                    overall_status = AutomationRuleRun.RunStatus.ERROR
            except Exception as exc:
                logger.exception("automation: action %s crashed", action_type, exc_info=exc)
                action_results.append(
                    {"idx": idx, "type": action_type, "ok": False, "error": str(exc)}
                )
                overall_status = AutomationRuleRun.RunStatus.ERROR

        from plane.db.models import AutomationRule

        AutomationRule.objects.filter(id=rule.id).update(
            last_fired_at=timezone.now(),
            fire_count=rule.fire_count + 1,
        )

        AutomationRuleRun.objects.create(
            rule=rule,
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            status=overall_status,
            detail={"trigger_context": ctx, "actions": action_results},
        )

    return overall_status


@shared_task
def evaluate_and_execute_rule_task(rule_id, issue_id, ctx=None, bypass_dedup=False):
    """Celery wrapper around `execute_rule_on_issue`.

    Loads the rule + issue, skipping silently if either was deleted /
    deactivated between dispatch and task execution.

    `bypass_dedup` is passed through to `execute_rule_on_issue` and is
    used by the target_date-changed kick in
    `_kick_due_soon_for_target_date_changes` so a rapid sequence of
    target_date edits each re-fires the rule.
    """
    from plane.db.models import AutomationRule, Issue

    rule = AutomationRule.objects.filter(
        id=rule_id, is_active=True, deleted_at__isnull=True
    ).first()
    if not rule:
        return  # rule deleted or deactivated between dispatch and task run

    issue = (
        Issue.issue_objects.select_related("state", "workspace", "project")
        .filter(id=issue_id)
        .first()
    )
    if not issue:
        return

    execute_rule_on_issue(rule, issue, ctx or {}, bypass_dedup=bypass_dedup)
