# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Automation Engine — periodic scheduled-rule evaluator.

Counterpart to `automation_engine_task.py`: that one handles event-driven
triggers (state_changed, assignee_added, ...); this one handles
time-based triggers (due_soon and, eventually, cron-based `scheduled`).

Run cadence is hourly via Celery beat. Self-dedup keeps any given rule
from firing on the same issue twice within DEDUP_TTL_SECONDS even when
the hourly job crosses calendar boundaries.
"""

# Python imports
import logging
from datetime import date, timedelta

# Third party
from celery import shared_task

logger = logging.getLogger("plane.bgtasks.automation_scheduled_task")

# Cap the work per rule per run. Without this a 50k-issue project with a
# loose condition could DOS the worker pool.
MAX_ISSUES_PER_RULE_PER_RUN = 1000


@shared_task
def evaluate_scheduled_automations_task(rule_id=None, bypass_dedup=False):
    """Scan active scheduled rules and fire each against matching issues.

    For trigger_type == "due_soon":
      Find issues in the rule's project whose target_date is within
      trigger_config["days_before"] days (default 7) of today, are not
      already in a completed / cancelled state, and pass the rule's
      conditions list. For each match, run the rule's actions.

    For trigger_type == "scheduled" (cron):
      Deferred to v2. v1 simply does not evaluate cron-based rules.

    Args:
      rule_id: optional UUID string. When set, only that one rule is
        evaluated. Used by the viewset to kick a rule immediately after
        the user saves it so they don't have to wait up to 60 minutes
        for the next hourly beat tick.
      bypass_dedup: when True, the per-(rule, issue) Redis dedup is
        ignored. Used together with rule_id on save so a re-saved rule
        re-evaluates issues that may already be inside the dedup window
        from a recent beat-driven run.
    """
    from plane.db.models import AutomationRule, Issue, StateGroup
    from plane.bgtasks.automation_engine_task import execute_rule_on_issue

    today = date.today()

    qs = AutomationRule.objects.select_related("project", "workspace").filter(
        trigger_type="due_soon",
        is_active=True,
        deleted_at__isnull=True,
    )
    if rule_id:
        qs = qs.filter(id=rule_id)
    rules = list(qs)
    if not rules:
        return {"rules": 0}

    fired = 0
    for rule in rules:
        try:
            days_before = int((rule.trigger_config or {}).get("days_before", 7))
            if days_before < 0:
                continue
            window_end = today + timedelta(days=days_before)

            candidates = list(
                Issue.issue_objects.select_related("state", "workspace", "project")
                .prefetch_related("assignees", "labels")
                .filter(
                    project_id=rule.project_id,
                    target_date__isnull=False,
                    target_date__lte=window_end,
                    target_date__gte=today,  # don't refire on overdue (separate stage)
                )
                .exclude(
                    state__group__in=[
                        StateGroup.COMPLETED.value,
                        StateGroup.CANCELLED.value,
                    ]
                )[:MAX_ISSUES_PER_RULE_PER_RUN]
            )

            for issue in candidates:
                try:
                    execute_rule_on_issue(
                        rule,
                        issue,
                        ctx={
                            "trigger_type": "due_soon",
                            "scheduled_run_date": today.isoformat(),
                            "days_before": days_before,
                            "manual_kick": bool(rule_id),
                        },
                        bypass_dedup=bypass_dedup,
                    )
                    fired += 1
                except Exception as exc:
                    logger.exception(
                        "scheduled automation: rule %s issue %s failed",
                        rule.id,
                        issue.id,
                        exc_info=exc,
                    )
        except Exception as exc:
            logger.exception("scheduled automation: rule %s setup failed", rule.id, exc_info=exc)

    return {"rules": len(rules), "fired": fired}
