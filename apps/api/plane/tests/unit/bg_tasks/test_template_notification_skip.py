# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Regression: template projects must be invisible to every bot
notification path.

When the project-templates feature shipped (migration 0129), several
fan-out paths weren't taught to skip is_template=True projects, so
users got 'task due tomorrow' / 'assigned to you' DMs (and bell-icon
unread counts, and email digests) about template blueprints. This
file pins all of them:

  - dispatch_lark_for_activities (event-driven DMs on assignee/state/comment)
  - dispatch_automation_for_activities (event-driven automation rules)
  - evaluate_scheduled_automations_task (hourly due_soon rule evaluator)
  - notify_issue_* tasks (defense-in-depth — direct .delay() must skip)
  - evaluate_and_execute_rule_task (defense-in-depth — direct .delay() must skip)
  - notifications (in-app bell + EmailNotificationLog enqueue)
  - send_email_notification / stack_email_notification (digest email)
"""

import os
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest

from plane.bgtasks.automation_engine_task import (
    _drop_template_activities as _drop_template_activities_automation,
    dispatch_automation_for_activities,
    evaluate_and_execute_rule_task,
)
from plane.bgtasks.automation_scheduled_task import (
    evaluate_scheduled_automations_task,
)
from plane.bgtasks.email_notification_task import (
    send_email_notification,
    stack_email_notification,
)
from plane.bgtasks.lark_notify_task import (
    _drop_template_activities as _drop_template_activities_lark,
    dispatch_lark_for_activities,
    notify_issue_assigned_task,
    notify_issue_comment_task,
    notify_issue_state_changed_task,
)
from plane.bgtasks.notification_task import notifications
from plane.db.models import (
    AutomationRule,
    EmailNotificationLog,
    Issue,
    IssueAssignee,
    IssueComment,
    Notification,
    Project,
)

LARK_NOTIFY_PATH = "plane.bgtasks.lark_notify_task"


@pytest.fixture
def template_project(workspace):
    return Project.objects.create(
        name="Template",
        identifier="tmpl",
        workspace=workspace,
        is_template=True,
    )


@pytest.fixture
def regular_project(workspace):
    return Project.objects.create(
        name="Regular",
        identifier="reg",
        workspace=workspace,
        is_template=False,
    )


# ---------------------------------------------------------------------------
# Dispatchers — the _drop_template_activities helper
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db
class TestDispatcherTemplateFilter:
    """Both dispatchers share the same helper signature; assert each
    independently so a copy-paste regression in one file is caught."""

    @pytest.mark.parametrize(
        "drop_fn",
        [_drop_template_activities_lark, _drop_template_activities_automation],
    )
    def test_drops_template_activities_and_keeps_regular(
        self, drop_fn, template_project, regular_project
    ):
        # IssueActivity has many required FKs; the dispatcher helper only
        # reads .project_id, so a lightweight stand-in is enough.
        acts = [
            SimpleNamespace(project_id=template_project.id, issue_id=uuid4()),
            SimpleNamespace(project_id=regular_project.id, issue_id=uuid4()),
            SimpleNamespace(project_id=template_project.id, issue_id=uuid4()),
        ]
        kept = drop_fn(acts)
        assert [a.project_id for a in kept] == [regular_project.id]

    @pytest.mark.parametrize(
        "drop_fn",
        [_drop_template_activities_lark, _drop_template_activities_automation],
    )
    def test_no_template_projects_returns_input_unchanged(
        self, drop_fn, regular_project
    ):
        acts = [SimpleNamespace(project_id=regular_project.id, issue_id=uuid4())]
        # Identity check: hot path avoids re-allocating the list.
        assert drop_fn(acts) is acts


@pytest.mark.unit
@pytest.mark.django_db
class TestDispatchLarkSkipsTemplates:
    """End-to-end through dispatch_lark_for_activities, parametrized
    across all three notifiable activity shapes — assignee, state,
    comment — so a future edit that adds a new field branch can't
    silently drop the template guard for that branch."""

    @pytest.mark.parametrize(
        "build_activity",
        [
            lambda pid, uid: SimpleNamespace(
                project_id=pid,
                issue_id=uuid4(),
                field="assignees",
                verb="created",
                new_identifier=uid,
                old_identifier=None,
                actor_id=None,
                issue_comment_id=None,
            ),
            lambda pid, uid: SimpleNamespace(
                project_id=pid,
                issue_id=uuid4(),
                field="state",
                verb="updated",
                new_identifier=uuid4(),
                old_identifier=uuid4(),
                actor_id=None,
                issue_comment_id=None,
            ),
            lambda pid, uid: SimpleNamespace(
                project_id=pid,
                issue_id=uuid4(),
                field="comment",
                verb="created",
                new_identifier=None,
                old_identifier=None,
                actor_id=None,
                issue_comment_id=uuid4(),
            ),
        ],
        ids=["assignee_added", "state_changed", "comment_created"],
    )
    def test_template_activity_does_not_queue_any_notify_task(
        self, template_project, create_user, build_activity
    ):
        act = build_activity(template_project.id, create_user.id)
        with (
            patch(
                "plane.bgtasks.lark_notify_task._lark_notifications_enabled",
                return_value=True,
            ),
            patch(
                "plane.bgtasks.lark_notify_task.notify_issue_assigned_task.delay"
            ) as mock_assigned,
            patch(
                "plane.bgtasks.lark_notify_task.notify_issue_state_changed_task.delay"
            ) as mock_state,
            patch(
                "plane.bgtasks.lark_notify_task.notify_issue_comment_task.delay"
            ) as mock_comment,
        ):
            dispatch_lark_for_activities([act])

        assert mock_assigned.call_count == 0
        assert mock_state.call_count == 0
        assert mock_comment.call_count == 0


@pytest.mark.unit
@pytest.mark.django_db
class TestNotifyIssueTasksDefenseInDepth:
    """Direct .delay() calls on the per-event notify tasks must skip
    template issues even if dispatch_lark were bypassed."""

    @pytest.fixture
    def template_issue(self, workspace, template_project, create_user):
        return Issue.objects.create(
            name="Template issue", workspace=workspace, project=template_project
        )

    def test_assigned_task_skips_template_issue(self, template_issue, create_user):
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch("plane.utils.lark_notify.get_union_id", return_value="union-x"),
            patch("plane.utils.lark_i18n.user_lang", return_value="en"),
            patch(
                "plane.utils.lark_notify.send_interactive_card", return_value=True
            ) as mock_send,
        ):
            notify_issue_assigned_task(
                str(template_issue.id), str(create_user.id), None
            )
        assert mock_send.call_count == 0

    def test_state_changed_task_skips_template_issue(
        self, template_issue, create_user, template_project, workspace
    ):
        IssueAssignee.objects.create(
            issue=template_issue,
            assignee=create_user,
            project=template_project,
            workspace=workspace,
        )
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch("plane.utils.lark_notify.get_union_id", return_value="union-x"),
            patch("plane.utils.lark_i18n.user_lang", return_value="en"),
            patch(
                "plane.utils.lark_notify.send_interactive_card", return_value=True
            ) as mock_send,
        ):
            notify_issue_state_changed_task(
                str(template_issue.id), None, None, None
            )
        assert mock_send.call_count == 0

    def test_comment_task_skips_template_issue(
        self, template_issue, create_user, template_project, workspace
    ):
        IssueAssignee.objects.create(
            issue=template_issue,
            assignee=create_user,
            project=template_project,
            workspace=workspace,
        )
        comment = IssueComment.objects.create(
            issue=template_issue,
            project=template_project,
            workspace=workspace,
            actor=create_user,
            comment_html="<p>hi</p>",
        )
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch("plane.utils.lark_notify.get_union_id", return_value="union-x"),
            patch("plane.utils.lark_i18n.user_lang", return_value="en"),
            patch(
                "plane.utils.lark_notify.send_interactive_card", return_value=True
            ) as mock_send,
        ):
            notify_issue_comment_task(
                str(template_issue.id), str(comment.id), None
            )
        assert mock_send.call_count == 0


@pytest.mark.unit
@pytest.mark.django_db
class TestEvaluateRuleTaskDefenseInDepth:
    """Direct .delay() on evaluate_and_execute_rule_task must skip when
    either the rule OR the issue lives on a template project."""

    def test_rule_on_template_project_does_not_execute(
        self, template_project, workspace, create_user
    ):
        rule = AutomationRule.objects.create(
            project=template_project,
            workspace=workspace,
            name="r",
            trigger_type="state_changed",
            trigger_config={},
            conditions=[],
            actions=[],
            is_active=True,
        )
        issue = Issue.objects.create(
            name="i", workspace=workspace, project=template_project
        )
        with patch(
            "plane.bgtasks.automation_engine_task.execute_rule_on_issue"
        ) as mock_exec:
            evaluate_and_execute_rule_task(str(rule.id), str(issue.id))
        assert mock_exec.call_count == 0


@pytest.mark.unit
@pytest.mark.django_db
class TestDispatchAutomationSkipsTemplates:
    """End-to-end through dispatch_automation_for_activities — neither
    the event-driven grouping nor the due_soon second-pass should fire
    for a template project."""

    def test_template_activity_does_not_queue_rule_evaluation(
        self, template_project, workspace, create_user
    ):
        # An active rule exists on the template so the only thing that
        # could stop dispatch is the template filter under test.
        AutomationRule.objects.create(
            project=template_project,
            workspace=workspace,
            name="state -> notify",
            trigger_type="state_changed",
            trigger_config={},
            conditions=[],
            actions=[],
            is_active=True,
        )
        act = SimpleNamespace(
            project_id=template_project.id,
            issue_id=uuid4(),
            field="state",
            verb="updated",
            old_value=None,
            new_value=None,
            old_identifier=None,
            new_identifier=None,
            actor_id=None,
            id=uuid4(),
        )
        with patch(
            "plane.bgtasks.automation_engine_task.evaluate_and_execute_rule_task.delay"
        ) as mock_delay:
            dispatch_automation_for_activities([act])

        assert mock_delay.call_count == 0


# ---------------------------------------------------------------------------
# Scheduled due_soon evaluator
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db
class TestScheduledAutomationSkipsTemplates:
    def test_due_soon_rule_in_template_project_does_not_fire(
        self, template_project, workspace, create_user
    ):
        rule = AutomationRule.objects.create(
            project=template_project,
            workspace=workspace,
            name="due_soon -> notify",
            trigger_type="due_soon",
            trigger_config={"days_before": 3},
            conditions=[],
            actions=[],
            is_active=True,
        )
        # Issue inside the template with a target_date inside the window
        # — this would fire if the rule weren't filtered out.
        issue = Issue.objects.create(
            name="Due soon in template",
            workspace=workspace,
            project=template_project,
            target_date=date.today() + timedelta(days=1),
        )
        IssueAssignee.objects.create(
            issue=issue,
            assignee=create_user,
            project=template_project,
            workspace=workspace,
        )

        with patch(
            "plane.bgtasks.automation_engine_task.execute_rule_on_issue"
        ) as mock_exec:
            result = evaluate_scheduled_automations_task()

        # No rule survives the project__is_template=False filter, so the
        # evaluator returns early with the "no rules" sentinel.
        assert result == {"rules": 0}
        assert mock_exec.call_count == 0
        # And the manually-passed rule_id path is the same — kick a save
        # on the template's rule explicitly and assert it still no-ops.
        with patch(
            "plane.bgtasks.automation_engine_task.execute_rule_on_issue"
        ) as mock_exec:
            result2 = evaluate_scheduled_automations_task(rule_id=str(rule.id))
        assert result2 == {"rules": 0}
        assert mock_exec.call_count == 0


# ---------------------------------------------------------------------------
# In-app bell + email digest
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.django_db
class TestInAppNotificationSkipsTemplates:
    """notifications() — the Celery task that backs the bell-icon unread
    count and enqueues EmailNotificationLog rows — must early-return for
    template projects without creating any rows."""

    def test_template_project_returns_before_project_member_query(
        self, template_project, workspace, create_user
    ):
        """Asserts the early-return fires by patching the FIRST query
        the task would otherwise run (ProjectMember.objects.filter at
        notification_task.py:231) and verifying it was never reached.
        Empty args alone don't prove the guard — the broad except at
        the bottom of notifications() can also short-circuit cleanly —
        so we pin the actual ordering."""
        issue = Issue.objects.create(
            name="i", workspace=workspace, project=template_project
        )
        with patch(
            "plane.bgtasks.notification_task.ProjectMember.objects"
        ) as mock_pm:
            notifications(
                type="issue.activity.updated",
                issue_id=str(issue.id),
                project_id=str(template_project.id),
                actor_id=str(create_user.id),
                subscriber=False,
                issue_activities_created="[]",
                requested_data=None,
                current_instance=None,
            )
        # Project.objects.filter(...).exists() bails BEFORE any
        # ProjectMember query. Hitting the patched manager would mean
        # the guard was skipped.
        assert mock_pm.filter.call_count == 0
        assert Notification.objects.count() == 0
        assert EmailNotificationLog.objects.count() == 0

    def test_regular_project_DOES_reach_project_member_query(
        self, regular_project, workspace, create_user
    ):
        """Positive control: a non-template project must NOT early-return,
        so ProjectMember.objects.filter is reached. This makes the negative
        test above meaningful — without it we couldn't distinguish 'guard
        fired' from 'broad except swallowed everything'."""
        issue = Issue.objects.create(
            name="i", workspace=workspace, project=regular_project
        )
        with patch(
            "plane.bgtasks.notification_task.ProjectMember.objects"
        ) as mock_pm:
            # Make the chain ProjectMember.objects.filter(...).values_list(...)
            # iterable so downstream code doesn't crash on something other
            # than the early-return we're testing.
            mock_pm.filter.return_value.values_list.return_value = []
            notifications(
                type="issue.activity.updated",
                issue_id=str(issue.id),
                project_id=str(regular_project.id),
                actor_id=str(create_user.id),
                subscriber=False,
                issue_activities_created="[]",
                requested_data=None,
                current_instance=None,
            )
        assert mock_pm.filter.call_count >= 1


@pytest.mark.unit
@pytest.mark.django_db
class TestEmailDigestSkipsTemplates:
    """send_email_notification (per-issue) and stack_email_notification
    (aggregator) must both skip template issues. We test both because a
    pre-existing EmailNotificationLog row from before the template-skip
    rollout could survive in the queue."""

    def test_send_email_notification_marks_template_log_processed_and_returns(
        self, template_project, workspace, create_user
    ):
        issue = Issue.objects.create(
            name="i", workspace=workspace, project=template_project
        )
        log = EmailNotificationLog.objects.create(
            entity_identifier=issue.id,
            entity_name="issue",
            receiver=create_user,
            triggered_by=create_user,
            data={},
        )
        # Acquire-the-lock + base_api branch must both pass so we reach
        # the Issue.objects.filter(...). The is_template filter then
        # nulls the issue and bails *after* marking the log processed.
        with (
            patch(
                "plane.bgtasks.email_notification_task.acquire_lock",
                return_value=True,
            ),
            patch(
                "plane.bgtasks.email_notification_task.redis_instance"
            ) as mock_redis,
            patch(
                "plane.bgtasks.email_notification_task.get_email_configuration",
                return_value=("h", "u", "p", "25", False, False, "from@x"),
            ),
            patch(
                "plane.bgtasks.email_notification_task.EmailMultiAlternatives"
            ) as mock_email,
        ):
            mock_redis.return_value.get.return_value = b"http://localhost"
            send_email_notification(
                issue_id=str(issue.id),
                notification_data={},
                receiver_id=str(create_user.id),
                email_notification_ids=[log.id],
            )
        log.refresh_from_db()
        assert log.processed_at is not None
        assert mock_email.call_count == 0

    def test_stack_email_notification_skips_and_sweeps_template_logs(
        self,
        template_project,
        regular_project,
        workspace,
        create_user,
    ):
        template_issue = Issue.objects.create(
            name="t", workspace=workspace, project=template_project
        )
        regular_issue = Issue.objects.create(
            name="r", workspace=workspace, project=regular_project
        )
        template_log = EmailNotificationLog.objects.create(
            entity_identifier=template_issue.id,
            entity_name="issue",
            receiver=create_user,
            triggered_by=create_user,
            data={},
        )
        regular_log = EmailNotificationLog.objects.create(
            entity_identifier=regular_issue.id,
            entity_name="issue",
            receiver=create_user,
            triggered_by=create_user,
            data={},
        )
        with patch(
            "plane.bgtasks.email_notification_task.send_email_notification.delay"
        ) as mock_send:
            stack_email_notification()

        # Only the regular log gets queued for sending…
        assert mock_send.call_count == 1
        kwargs = mock_send.call_args.kwargs
        assert kwargs["issue_id"] == regular_issue.id
        assert regular_log.id in kwargs["email_notification_ids"]

        # …and the template log is swept (processed_at set) so it
        # doesn't loop forever as a ghost row on every stack run.
        template_log.refresh_from_db()
        assert template_log.processed_at is not None
        # (The regular log also ends up with processed_at set by
        # stack_email_notification's existing tail update — that's the
        # "batched/consumed" semantic, not "email sent". We don't assert
        # on it here; it's not part of the template-skip contract.)
