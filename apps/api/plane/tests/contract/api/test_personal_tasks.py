# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the personal-tasks token endpoint
(``/api/v1/workspaces/{slug}/personal-tasks/``)."""

import json
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import APIToken, Issue, User, Workspace, WorkspaceMember


@pytest.fixture(autouse=True)
def _no_celery(mocker):
    """Celery tasks aren't routable in this local test env (no RabbitMQ);
    the production behavior under test is the HTTP contract, not the
    activity-stream side-effect, so mock the .delay() entry points.
    """
    mocker.patch("plane.api.views.personal_task.issue_activity.delay")
    mocker.patch("plane.api.views.personal_task.model_activity.delay")


@pytest.fixture
def system_token(db, create_bot_user):
    """A token flagged ``is_service=True`` — what production gates the
    personal-tasks endpoint behind."""
    return APIToken.objects.create(
        user=create_bot_user,
        label="System token (test)",
        token="sys-token-for-personal-tasks",
        is_service=True,
    )


@pytest.fixture
def system_api_client(api_client, system_token):
    api_client.credentials(HTTP_X_API_KEY=system_token.token)
    return api_client


@pytest.fixture
def non_system_api_client(api_client, api_token):
    """The default ``api_token`` fixture creates a non-service token."""
    api_client.credentials(HTTP_X_API_KEY=api_token.token)
    return api_client


@pytest.fixture
def owner_user(db):
    """A second user, will become the target ``owner`` of personal tasks."""
    user = User.objects.create(
        email="owner@plane.so",
        username="owner_user",
        first_name="Owner",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


@pytest.fixture
def workspace_with_owner(create_user, owner_user):
    """Workspace where both ``create_user`` (token owner) and
    ``owner_user`` (target) are active members."""
    workspace = Workspace.objects.create(
        name="Test Workspace",
        owner=create_user,
        slug="test-workspace",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=create_user, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=owner_user, role=15)
    return workspace


def _personal_tasks_url(slug):
    return f"/api/v1/workspaces/{slug}/personal-tasks/"


def _personal_task_detail_url(slug, work_item_id):
    return f"/api/v1/workspaces/{slug}/personal-tasks/{work_item_id}/"


@pytest.mark.contract
class TestPersonalTasksCreatePermissions:
    """Permission boundary: only system tokens may call this endpoint."""

    @pytest.mark.django_db
    def test_non_system_token_is_forbidden(
        self, non_system_api_client, workspace_with_owner, owner_user
    ):
        response = non_system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Should be rejected",
                "external_source": "test",
                "external_id": "x-1",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_anonymous_is_forbidden(self, api_client, workspace_with_owner, owner_user):
        response = api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Should be rejected",
                "external_source": "test",
                "external_id": "x-2",
            },
            format="json",
        )
        # Anonymous token-API hits the IsAuthenticated permission first → 401.
        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )


@pytest.mark.contract
class TestPersonalTasksCreateValidation:
    """Body validation: required fields must be present."""

    @pytest.mark.django_db
    def test_missing_owner_is_bad_request(
        self, system_api_client, workspace_with_owner
    ):
        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={"name": "x", "external_source": "s", "external_id": "i"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_missing_external_keys_is_bad_request(
        self, system_api_client, workspace_with_owner, owner_user
    ):
        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={"owner": str(owner_user.id), "name": "x"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_owner_not_in_workspace_is_forbidden(
        self, system_api_client, workspace_with_owner
    ):
        outsider = User.objects.create(
            email="outsider@plane.so",
            username="outsider_user",
            first_name="Outsider",
            last_name="User",
        )
        outsider.set_password("test-password")
        outsider.save()
        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(outsider.id),
                "name": "Cross-workspace probe",
                "external_source": "test",
                "external_id": "i-1",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestPersonalTasksCreateSuccess:
    """Happy-path creates + idempotency."""

    @pytest.mark.django_db
    def test_creates_personal_project_lazily_then_work_item(
        self, system_api_client, workspace_with_owner, owner_user
    ):
        """§8 acceptance: target bucket does not exist → auto-created
        + 201 with the new work item details."""
        from plane.db.models import Project

        assert not Project.objects.filter(
            workspace=workspace_with_owner,
            is_personal=True,
            personal_owner=owner_user,
        ).exists()

        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Lazy bucket smoke",
                "priority": "high",
                "external_source": "task-manager-v1",
                "external_id": "smoke-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )

        assert response.status_code == status.HTTP_201_CREATED, response.content
        body = response.json()
        assert "id" in body
        assert "project_id" in body
        assert body["project_identifier"].startswith("MT")
        assert "sequence_id" in body
        assert "url" in body

        project = Project.objects.get(
            workspace=workspace_with_owner,
            is_personal=True,
            personal_owner=owner_user,
        )
        issue = Issue.objects.get(pk=body["id"])
        assert issue.project_id == project.id
        # owner is auto-assigned so the task shows up in their My Tasks view
        assert issue.assignees.filter(pk=owner_user.id).exists()

    @pytest.mark.django_db
    def test_duplicate_external_keys_returns_409_with_existing_id(
        self, system_api_client, workspace_with_owner, owner_user
    ):
        """§8 acceptance: same (project, external_source, external_id)
        re-submitted returns 409 + the existing work item id."""
        payload = {
            "owner": str(owner_user.id),
            "name": "First create",
            "external_source": "task-manager-v1",
            "external_id": "dup-key",
        }
        first = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data=payload,
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert first.status_code == status.HTTP_201_CREATED
        first_id = first.json()["id"]

        second = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={**payload, "name": "Should not overwrite"},
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert second.status_code == status.HTTP_409_CONFLICT
        assert second.json()["id"] == first_id


@pytest.mark.contract
class TestPersonalTasksPatch:
    """PATCH boundary: only the original creator-source may modify."""

    @pytest.mark.django_db
    def test_patch_with_wrong_external_source_is_forbidden(
        self, system_api_client, workspace_with_owner, owner_user
    ):
        """§8 acceptance: PATCH for a work item created by source A,
        called with source B in body, must 403."""
        created = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Mine",
                "external_source": "source-a",
                "external_id": "patch-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert created.status_code == status.HTTP_201_CREATED
        work_item_id = created.json()["id"]

        response = system_api_client.patch(
            _personal_task_detail_url(workspace_with_owner.slug, work_item_id),
            data={"name": "Hijack attempt", "external_source": "source-b"},
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_patch_with_matching_external_source_updates(
        self, system_api_client, workspace_with_owner, owner_user
    ):
        created = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Original name",
                "external_source": "source-a",
                "external_id": "patch-2",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert created.status_code == status.HTTP_201_CREATED
        work_item_id = created.json()["id"]

        response = system_api_client.patch(
            _personal_task_detail_url(workspace_with_owner.slug, work_item_id),
            data={"name": "Updated name", "external_source": "source-a"},
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert response.status_code == status.HTTP_200_OK
        assert Issue.objects.get(pk=work_item_id).name == "Updated name"

    @pytest.mark.django_db
    def test_patch_nonexistent_returns_404(
        self, system_api_client, workspace_with_owner
    ):
        response = system_api_client.patch(
            _personal_task_detail_url(workspace_with_owner.slug, uuid.uuid4()),
            data={"name": "x", "external_source": "any"},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestPersonalTasksWebhookFanOut:
    """The personal-tasks endpoint must trigger ``model_activity.delay``
    so the Lark bot (and any other webhook subscriber) receives the
    ``issue.created`` / ``issue.updated`` event and can DM the assignee.

    Regression guard: the original endpoint only fired ``issue_activity``
    and silently dropped the webhook fan-out, breaking Lark notifications
    for tasks created via the new system-token path.
    """

    @pytest.mark.django_db
    def test_post_triggers_model_activity_for_webhook_fanout(
        self, system_api_client, workspace_with_owner, owner_user, mocker
    ):
        spy = mocker.patch("plane.api.views.personal_task.model_activity.delay")
        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Fanout me",
                "external_source": "task-manager-v1",
                "external_id": "fanout-post-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert spy.called, "model_activity.delay was not invoked for POST"
        kwargs = spy.call_args.kwargs
        assert kwargs["model_name"] == "issue"
        assert kwargs["model_id"] == response.json()["id"]
        assert kwargs["current_instance"] is None
        assert kwargs["slug"] == workspace_with_owner.slug
        assert kwargs["actor_id"] is not None

    @pytest.mark.django_db
    def test_patch_triggers_model_activity_for_webhook_fanout(
        self, system_api_client, workspace_with_owner, owner_user, mocker
    ):
        created = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Pre-patch name",
                "external_source": "source-a",
                "external_id": "fanout-patch-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert created.status_code == status.HTTP_201_CREATED
        work_item_id = created.json()["id"]

        # Spy AFTER the create so we only capture the PATCH call.
        spy = mocker.patch("plane.api.views.personal_task.model_activity.delay")
        response = system_api_client.patch(
            _personal_task_detail_url(workspace_with_owner.slug, work_item_id),
            data={"name": "Patched name", "external_source": "source-a"},
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        assert spy.called, "model_activity.delay was not invoked for PATCH"
        kwargs = spy.call_args.kwargs
        assert kwargs["model_name"] == "issue"
        assert kwargs["model_id"] == work_item_id
        # PATCH must pass the pre-update serialized issue so the webhook
        # task can diff old vs new and emit per-field updated events.
        assert kwargs["current_instance"] is not None
        assert kwargs["slug"] == workspace_with_owner.slug

    @pytest.mark.django_db
    def test_post_requested_data_includes_assignee_ids_for_lark_gate(
        self, system_api_client, workspace_with_owner, owner_user, mocker
    ):
        """The real Lark fan-out path: ``create_issue_activity``
        (issue_activities_task.py:581) only calls ``track_assignees``
        when ``requested_data.get('assignee_ids') is not None``. Our
        API serializer uses the ``assignees`` key, so the issue_activity
        payload MUST mirror it under ``assignee_ids`` or the assignee
        IssueActivity row is never emitted and dispatch_lark_for_activities
        sees nothing to DM.
        """
        spy = mocker.patch("plane.api.views.personal_task.issue_activity.delay")
        response = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Notify me on Lark",
                "external_source": "task-manager-v1",
                "external_id": "lark-gate-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert spy.called, "issue_activity.delay was not invoked"
        requested_data = json.loads(spy.call_args.kwargs["requested_data"])
        assert "assignee_ids" in requested_data, (
            "issue_activity.requested_data is missing 'assignee_ids' — "
            "create_issue_activity will skip track_assignees and no Lark "
            "DM will fire."
        )
        assert requested_data["assignee_ids"] == [str(owner_user.id)]

    @pytest.mark.django_db
    def test_idempotent_409_reuse_does_not_trigger_model_activity(
        self, system_api_client, workspace_with_owner, owner_user, mocker
    ):
        """Spec §"顺手注意": the 409 idempotent-reuse path MUST NOT fire
        the webhook — nothing was actually created."""
        payload = {
            "owner": str(owner_user.id),
            "name": "First create",
            "external_source": "task-manager-v1",
            "external_id": "no-double-fire",
        }
        first = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data=payload,
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert first.status_code == status.HTTP_201_CREATED

        spy = mocker.patch("plane.api.views.personal_task.model_activity.delay")
        second = system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data=payload,
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert second.status_code == status.HTTP_409_CONFLICT
        assert not spy.called, "409 idempotent reuse must not refire webhook"


@pytest.mark.contract
class TestPersonalTasksAuditTrail:
    """The audit middleware must record the target owner as
    ``acting_on_behalf_of`` so system-on-behalf-of-X is queryable later."""

    @pytest.mark.django_db
    def test_post_sets_acting_on_behalf_of_to_owner(
        self, system_api_client, workspace_with_owner, owner_user, mocker
    ):
        spy = mocker.patch("plane.middleware.logger.process_logs.delay")
        system_api_client.post(
            _personal_tasks_url(workspace_with_owner.slug),
            data={
                "owner": str(owner_user.id),
                "name": "Audit me",
                "external_source": "task-manager-v1",
                "external_id": "audit-1",
            },
            format="json",
            HTTP_HOST="task.example.com",
        )
        assert spy.called, "audit middleware did not fire process_logs.delay"
        log_data = spy.call_args.kwargs.get("log_data") or spy.call_args.args[0]
        assert str(log_data["acting_on_behalf_of"]) == str(owner_user.id)
