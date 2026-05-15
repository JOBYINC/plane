# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Default Automation Engine rules bootstrapped into every new project.

Companion to plane/db/models/state.py's DEFAULT_STATES. State-group
references (backlog / unstarted / completed / cancelled) are used
instead of state UUIDs so the templates work cross-project regardless
of which states a user later renames or adds.
"""

import logging

logger = logging.getLogger("plane.utils.automation_templates")


# Tailored to the task-management workflow (Inbox / Todo / In Progress /
# Waiting / Done). Each entry passes the same serializer validation as
# a user-built rule -- see plane/app/serializers/automation.py.
DEFAULT_AUTOMATION_RULES = [
    {
        "name": "Inbox → Todo when due approaching",
        "description": (
            "Pulls tasks out of the long-term Inbox queue 7 days before "
            "their target date, so they surface in the active Todo list "
            "before work needs to start. Designed for the 'plan many "
            "tasks ahead and let them sit in Inbox' pattern."
        ),
        "trigger_type": "due_soon",
        "trigger_config": {"days_before": 7},
        "conditions": [
            {"field": "state_group", "op": "eq", "value": "backlog"},
        ],
        "actions": [
            {"type": "set_state", "config": {"state_group": "unstarted"}},
        ],
        "is_active": True,
    },
    {
        "name": "Notify on urgent",
        "description": (
            "DMs assignees as soon as a task is marked Urgent. Catches "
            "in-the-moment escalations that would otherwise wait for "
            "the next hourly digest."
        ),
        "trigger_type": "priority_changed",
        "trigger_config": {},
        "conditions": [
            {"field": "priority", "op": "eq", "value": "urgent"},
        ],
        "actions": [
            {"type": "notify_lark", "config": {"to": "assignees"}},
        ],
        "is_active": True,
    },
    {
        "name": "Due in 3 days warning",
        "description": (
            "Soft heads-up DM to assignees 3 days before target date. "
            "Skips anything already Done or Cancelled."
        ),
        "trigger_type": "due_soon",
        "trigger_config": {"days_before": 3},
        "conditions": [
            {"field": "state_group", "op": "not_in", "value": ["completed", "cancelled"]},
        ],
        "actions": [
            {"type": "notify_lark", "config": {"to": "assignees"}},
        ],
        "is_active": True,
    },
    {
        "name": "Due tomorrow escalation",
        "description": (
            "Last-day warning: DM assignees and bump priority to Urgent "
            "so the task surfaces in priority filters. Engine actions "
            "never re-trigger the dispatcher, so this doesn't double-DM "
            "with 'Notify on urgent'."
        ),
        "trigger_type": "due_soon",
        "trigger_config": {"days_before": 1},
        "conditions": [
            {"field": "state_group", "op": "not_in", "value": ["completed", "cancelled"]},
        ],
        "actions": [
            {"type": "notify_lark", "config": {"to": "assignees"}},
            {"type": "set_priority", "config": {"priority": "urgent"}},
        ],
        "is_active": True,
    },
]


def create_default_automation_rules_for_project(project, created_by=None):
    """Bootstrap a freshly-created project with the standard rule set.

    Best-effort: a bug in this code path must not stop project creation.
    Failures are logged; users can always add rules later from the UI.
    """
    from plane.db.models import AutomationRule

    try:
        rules = [
            AutomationRule(
                project=project,
                workspace=project.workspace,
                name=tpl["name"],
                description=tpl["description"],
                trigger_type=tpl["trigger_type"],
                trigger_config=tpl["trigger_config"],
                conditions=tpl["conditions"],
                actions=tpl["actions"],
                is_active=tpl.get("is_active", True),
                created_by=created_by,
            )
            for tpl in DEFAULT_AUTOMATION_RULES
        ]
        AutomationRule.objects.bulk_create(rules)
    except Exception as exc:
        logger.exception(
            "automation_templates: failed to bootstrap project %s",
            project.id,
            exc_info=exc,
        )
