# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Regression: the hourly Lark due-date reminder must DM once per
(issue, assignee, stage, day) and survive a non-persistent cache.

Before the durable LarkDueReminderLog the dedup was a 25h Redis key; if
the deployment cache was lost/non-shared the hourly beat re-DM'd the same
assignee dozens of times. These tests pin the durable behaviour.
"""

import os
from datetime import date
from unittest.mock import patch

import pytest

from plane.bgtasks.lark_due_reminder_task import remind_due_dates_task
from plane.db.models import Issue, IssueAssignee, LarkDueReminderLog, Project

LARK_NOTIFY = "plane.utils.lark_notify"
LARK_I18N = "plane.utils.lark_i18n"


@pytest.mark.unit
class TestLarkDueReminderDedup:
    @pytest.fixture
    def project(self, create_user, workspace):
        return Project.objects.create(
            name="Test Project", identifier="test-project", workspace=workspace
        )

    @pytest.fixture
    def issue(self, workspace, project, create_user):
        # target_date == today -> "today" stage; not completed/cancelled.
        issue = Issue.objects.create(
            name="Due today",
            workspace=workspace,
            project=project,
            target_date=date.today(),
        )
        # Plane's assignees m2m goes through IssueAssignee (ProjectBaseModel:
        # project + workspace are NOT NULL), so .add() alone is invalid.
        IssueAssignee.objects.create(
            issue=issue, assignee=create_user, project=project, workspace=workspace
        )
        return issue

    @pytest.mark.django_db
    def test_sends_once_then_dedups_across_runs(self, issue, create_user):
        """The same hourly run repeated must DM exactly once, not every hour."""
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch(f"{LARK_NOTIFY}.send_interactive_card", return_value=True) as mock_send,
            patch(f"{LARK_NOTIFY}.get_union_id", return_value="union-123"),
            patch(f"{LARK_NOTIFY}.card_issue_due_reminder", return_value={}),
            patch(f"{LARK_I18N}.user_lang", return_value="en"),
        ):
            first = remind_due_dates_task()
            second = remind_due_dates_task()
            third = remind_due_dates_task()

        assert mock_send.call_count == 1  # not once-per-run
        assert first["sent"] == 1
        assert second["sent"] == 0 and second["skipped_dup"] == 1
        assert third["sent"] == 0 and third["skipped_dup"] == 1

        log = LarkDueReminderLog.objects.get(
            issue=issue, receiver=create_user, stage="today", reminder_date=date.today()
        )
        assert log.sent_at is not None

    @pytest.mark.django_db
    def test_failed_send_releases_claim_so_a_later_run_retries(self, issue, create_user):
        """A failed send must NOT consume the once/day slot — claim is released."""
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch(f"{LARK_NOTIFY}.get_union_id", return_value="union-123"),
            patch(f"{LARK_NOTIFY}.card_issue_due_reminder", return_value={}),
            patch(f"{LARK_I18N}.user_lang", return_value="en"),
        ):
            with patch(f"{LARK_NOTIFY}.send_interactive_card", return_value=False):
                failed = remind_due_dates_task()
            # claim released -> no live row blocks the retry
            assert failed["sent"] == 0 and failed["errored"] == 1
            assert not LarkDueReminderLog.objects.filter(
                issue=issue, receiver=create_user, stage="today", reminder_date=date.today()
            ).exists()

            with patch(f"{LARK_NOTIFY}.send_interactive_card", return_value=True) as mock_ok:
                retried = remind_due_dates_task()

        assert retried["sent"] == 1
        assert mock_ok.call_count == 1

    @pytest.mark.django_db
    def test_noop_when_disabled(self, issue):
        with patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": ""}):
            result = remind_due_dates_task()
        assert "skipped" in result
        assert LarkDueReminderLog.objects.count() == 0


@pytest.mark.unit
class TestLarkDueReminderSkipsTemplates:
    """Regression: template projects are blueprints — issues inside them
    must never trigger due-date DMs even when target_date is today/soon.
    Filed after a user reported template tasks DM'ing on the 'Due in 3 days'
    reminder; the dispatcher had no is_template filter."""

    @pytest.fixture
    def template_project(self, workspace):
        return Project.objects.create(
            name="Template Project",
            identifier="tmpl-project",
            workspace=workspace,
            is_template=True,
        )

    @pytest.fixture
    def template_issue(self, workspace, template_project, create_user):
        issue = Issue.objects.create(
            name="Due today (template)",
            workspace=workspace,
            project=template_project,
            target_date=date.today(),
        )
        IssueAssignee.objects.create(
            issue=issue,
            assignee=create_user,
            project=template_project,
            workspace=workspace,
        )
        return issue

    @pytest.mark.django_db
    def test_template_issues_never_send(self, template_issue, create_user):
        with (
            patch.dict(os.environ, {"LARK_NOTIFICATIONS_ENABLED": "1"}),
            patch(f"{LARK_NOTIFY}.send_interactive_card", return_value=True) as mock_send,
            patch(f"{LARK_NOTIFY}.get_union_id", return_value="union-123"),
            patch(f"{LARK_NOTIFY}.card_issue_due_reminder", return_value={}),
            patch(f"{LARK_I18N}.user_lang", return_value="en"),
        ):
            result = remind_due_dates_task()

        assert mock_send.call_count == 0
        assert result["sent"] == 0
        assert result["candidates"] == 0
        assert LarkDueReminderLog.objects.count() == 0
