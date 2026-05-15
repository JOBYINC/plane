# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import logging

# Django imports
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

# Module imports
from plane.bgtasks.lark_project_autojoin import (
    autojoin_workspace_members_to_project_task,
)
# Side-effect import: forces Celery to register notify_issue_* tasks at app
# startup. Without this, only the lazy import inside issue_activities_task
# would load the module — too late for the worker's autodiscovery sweep.
from plane.bgtasks import lark_notify_task  # noqa: F401

# Same eager-import trick for the periodic due-date reminder task; otherwise
# Celery beat finds no handler when its schedule fires remind_due_dates_task.
from plane.bgtasks import lark_due_reminder_task  # noqa: F401

# Automation Engine: register evaluate_and_execute_rule_task with Celery so
# dispatch_automation_for_activities (called from issue_activities_task)
# can .delay() it. Lazy import inside the dispatch would be too late.
from plane.bgtasks import automation_engine_task  # noqa: F401

# Hourly scheduled-rule evaluator (due_soon). Celery beat needs the task
# registered at worker startup, same pattern as lark_due_reminder_task.
from plane.bgtasks import automation_scheduled_task  # noqa: F401
from plane.db.models import Project

logger = logging.getLogger("plane.bgtasks.signals")


@receiver(post_save, sender=Project)
def queue_lark_project_autojoin(sender, instance, created, **kwargs):
    """When a new Project is created, queue a background job to add every
    active workspace member as a ProjectMember. The task short-circuits
    unless LARK_AUTO_JOIN_NEW_PROJECTS is enabled, so this signal is a
    cheap no-op for deploys that haven't opted in.

    Runs out-of-band via Celery rather than inline because adding 500
    members serially during project creation would block the HTTP response.
    """
    if not created or instance.id is None:
        return
    transaction.on_commit(
        lambda: autojoin_workspace_members_to_project_task.delay(str(instance.id))
    )


# Issue notification dispatch lives in issue_activities_task.issue_activity,
# right after IssueActivity.objects.bulk_create — Django's post_save signal
# does NOT fire on bulk_create, so a receiver here would silently never run.
# See plane/bgtasks/lark_notify_task.dispatch_lark_for_activities.
