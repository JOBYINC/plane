# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models

from .project import ProjectBaseModel


class AutomationTriggerType(models.TextChoices):
    # Event-driven triggers (fire from issue_activities_task after bulk_create
    # of IssueActivity rows; matched against IssueActivity.field).
    STATE_CHANGED = "state_changed", "State changed"
    ASSIGNEE_ADDED = "assignee_added", "Assignee added"
    ASSIGNEE_REMOVED = "assignee_removed", "Assignee removed"
    PRIORITY_CHANGED = "priority_changed", "Priority changed"
    TARGET_DATE_CHANGED = "target_date_changed", "Target date changed"
    LABELS_CHANGED = "labels_changed", "Labels changed"
    COMMENT_ADDED = "comment_added", "Comment added"
    # Scheduled triggers (evaluated by a periodic Celery task; see
    # plane/bgtasks/automation_scheduled_task.py).
    DUE_SOON = "due_soon", "Due soon"
    SCHEDULED = "scheduled", "Scheduled (cron)"


class AutomationRule(ProjectBaseModel):
    """A user-defined rule: trigger + conditions + actions.

    Schema kept intentionally JSON-heavy (trigger_config / conditions /
    actions) so we can ship new trigger and action types without a
    migration each time. Validation is enforced in the serializer layer.
    """

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    trigger_type = models.CharField(max_length=64, choices=AutomationTriggerType.choices)

    # trigger_config shapes by trigger_type:
    #   state_changed:    {"from_state_ids": [...], "to_state_ids": [...]}
    #   due_soon:         {"days_before": 7}
    #   scheduled:        {"cron": "0 9 * * 1-5"}     (Celery crontab syntax)
    #   others:           {}
    trigger_config = models.JSONField(default=dict, blank=True)

    # conditions: list of predicates, AND-joined. Each item:
    #   {"field": "<name>", "op": "<operator>", "value": <any>}
    # Fields: priority, state, state_group, assignee_ids, label_ids,
    #   target_date, start_date, sequence_id.
    # Ops: eq, ne, in, not_in, gt, lt, contains, is_null, is_not_null.
    conditions = models.JSONField(default=list, blank=True)

    # actions: list of action items, executed sequentially. Each item:
    #   {"type": "<action_type>", "config": {...}}
    # Types:
    #   set_state        config: {"state_id": "<uuid>"} or
    #                            {"state_group": "started"}
    #   set_priority     config: {"priority": "urgent"|"high"|...|"none"}
    #   add_assignee     config: {"user_id": "<uuid>"}
    #   remove_assignee  config: {"user_id": "<uuid>"}
    #   add_label        config: {"label_id": "<uuid>"}
    #   set_target_date  config: {"target_date": "YYYY-MM-DD"} or
    #                            {"days_from_now": N}
    #   notify_lark      config: {"message": "...", "to": "assignees"|
    #                                              "creator"|"user_id:<uuid>"}
    #   webhook          config: {"url": "https://...", "payload": {...}}
    actions = models.JSONField(default=list, blank=True)

    is_active = models.BooleanField(default=True)

    # Populated by the engine. Useful for the rules-list UI and for
    # debugging quiet rules.
    last_fired_at = models.DateTimeField(null=True, blank=True)
    fire_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Automation Rule"
        verbose_name_plural = "Automation Rules"
        db_table = "automation_rules"
        ordering = ("-created_at",)
        indexes = [
            # Engine hot path: "give me all active rules in this project
            # whose trigger_type matches the activity I just observed."
            models.Index(fields=["project", "is_active", "trigger_type"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.trigger_type}) <{self.project_id}>"


class AutomationRuleRun(ProjectBaseModel):
    """Audit log of every rule firing.

    Separate small table so the UI can show "last 50 runs" per rule and
    so we can debug silent rules (matched trigger but failed a condition,
    or an action errored).
    """

    class RunStatus(models.TextChoices):
        SUCCESS = "success", "Success"
        SKIPPED_CONDITION = "skipped_condition", "Skipped (condition not met)"
        SKIPPED_DEDUP = "skipped_dedup", "Skipped (dedup)"
        SKIPPED_LOOP = "skipped_loop", "Skipped (loop guard)"
        ERROR = "error", "Error"

    rule = models.ForeignKey(
        AutomationRule,
        on_delete=models.CASCADE,
        related_name="runs",
    )
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.CASCADE,
        related_name="automation_runs",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=32, choices=RunStatus.choices)
    # Free-form: which actions ran, which failed, why a condition skipped.
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Automation Rule Run"
        verbose_name_plural = "Automation Rule Runs"
        db_table = "automation_rule_runs"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["rule", "-created_at"]),
        ]

    def __str__(self):
        return f"run<{self.rule_id} {self.status}>"
