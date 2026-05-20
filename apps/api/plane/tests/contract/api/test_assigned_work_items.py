# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the assigned-work-items system-token endpoint
(``/api/v1/workspaces/{slug}/assigned-work-items/``)."""

import uuid

import pytest
from rest_framework import status

from plane.app.services.personal_project import get_or_create_personal_project
from plane.db.models import (
    APIToken,
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    StateGroup,
    User,
    Workspace,
    WorkspaceMember,
)


@pytest.fixture
def system_token(db, create_bot_user):
    return APIToken.objects.create(
        user=create_bot_user,
        label="System token (test)",
        token="sys-token-for-assigned-work-items",
        is_service=True,
    )


@pytest.fixture
def system_api_client(api_client, system_token):
    api_client.credentials(HTTP_X_API_KEY=system_token.token)
    return api_client


@pytest.fixture
def non_system_api_client(api_client, api_token):
    api_client.credentials(HTTP_X_API_KEY=api_token.token)
    return api_client


@pytest.fixture
def target_user(db):
    user = User.objects.create(
        email="target@plane.so",
        username="target_user",
        first_name="Target",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


@pytest.fixture
def other_user(db):
    user = User.objects.create(
        email="other@plane.so",
        username="other_user",
        first_name="Other",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


@pytest.fixture
def workspace_with_members(create_user, target_user, other_user):
    workspace = Workspace.objects.create(
        name="Test Workspace",
        owner=create_user,
        slug="test-workspace",
    )
    for member in (create_user, target_user, other_user):
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=20)
    return workspace


@pytest.fixture
def shared_project_with_state(workspace_with_members, create_user, target_user, other_user):
    """A normal (non-personal) project where all three users are members."""
    project = Project.objects.create(
        name="Shared Project",
        identifier="SHP",
        workspace=workspace_with_members,
        created_by=create_user,
    )
    for member in (create_user, target_user, other_user):
        ProjectMember.objects.create(project=project, member=member, role=20)
    state = State.objects.create(
        name="Todo",
        color="#000000",
        project=project,
        workspace=workspace_with_members,
        group=StateGroup.UNSTARTED.value,
        default=True,
        sequence=15000,
    )
    return project, state


def _create_issue(project, state, name, *, assignees, workspace, creator):
    issue = Issue.objects.create(
        name=name,
        project=project,
        state=state,
        workspace=workspace,
        created_by=creator,
    )
    # The IssueAssignee through table extends ProjectBaseModel, so it
    # requires project + workspace to be filled — ``issue.assignees.add()``
    # would leave those NULL and trip the NOT NULL constraint.
    for member in assignees:
        IssueAssignee.objects.create(
            issue=issue,
            assignee=member,
            project=project,
            workspace=workspace,
        )
    return issue


def _assigned_url(slug, assignee=None, **extra):
    base = f"/api/v1/workspaces/{slug}/assigned-work-items/"
    params = []
    if assignee is not None:
        params.append(f"assignee={assignee}")
    for k, v in extra.items():
        params.append(f"{k}={v}")
    return f"{base}?{'&'.join(params)}" if params else base


@pytest.mark.contract
class TestAssignedWorkItemsPermissions:
    @pytest.mark.django_db
    def test_non_system_token_is_forbidden(
        self, non_system_api_client, workspace_with_members, target_user
    ):
        response = non_system_api_client.get(
            _assigned_url(workspace_with_members.slug, assignee=target_user.id)
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_anonymous_is_unauthorized(self, api_client, workspace_with_members, target_user):
        response = api_client.get(
            _assigned_url(workspace_with_members.slug, assignee=target_user.id)
        )
        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )


@pytest.mark.contract
class TestAssignedWorkItemsValidation:
    @pytest.mark.django_db
    def test_missing_assignee_query_param_is_bad_request(
        self, system_api_client, workspace_with_members
    ):
        response = system_api_client.get(_assigned_url(workspace_with_members.slug))
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_malformed_assignee_uuid_is_bad_request(
        self, system_api_client, workspace_with_members
    ):
        response = system_api_client.get(
            _assigned_url(workspace_with_members.slug, assignee="not-a-uuid")
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestAssignedWorkItemsListing:
    """Privacy + completeness: returns target's items across personal +
    shared projects; does not leak items target isn't assigned to."""

    @pytest.mark.django_db
    def test_returns_target_items_across_personal_and_shared(
        self,
        system_api_client,
        workspace_with_members,
        create_user,
        target_user,
        other_user,
        shared_project_with_state,
    ):
        shared_project, shared_state = shared_project_with_state

        # Seed target's personal bucket and add a default state so the
        # FK on Issue.state can be satisfied.
        personal_project = get_or_create_personal_project(
            workspace=workspace_with_members,
            owner=target_user,
            actor=create_user,
        )
        personal_state = State.all_state_objects.filter(
            project=personal_project, default=True
        ).first()

        # Items assigned to target in BOTH project types (should appear)
        in_personal = _create_issue(
            personal_project,
            personal_state,
            "Personal task",
            assignees=[target_user],
            workspace=workspace_with_members,
            creator=create_user,
        )
        in_shared = _create_issue(
            shared_project,
            shared_state,
            "Shared task target works on",
            assignees=[target_user],
            workspace=workspace_with_members,
            creator=create_user,
        )

        # Items in the same workspace but NOT assigned to target (must
        # not appear): shared project task assigned to other_user, and
        # other_user's own personal task.
        _create_issue(
            shared_project,
            shared_state,
            "Other's shared task",
            assignees=[other_user],
            workspace=workspace_with_members,
            creator=create_user,
        )
        other_personal = get_or_create_personal_project(
            workspace=workspace_with_members,
            owner=other_user,
            actor=create_user,
        )
        other_personal_state = State.all_state_objects.filter(
            project=other_personal, default=True
        ).first()
        _create_issue(
            other_personal,
            other_personal_state,
            "Other's personal task",
            assignees=[other_user],
            workspace=workspace_with_members,
            creator=create_user,
        )

        response = system_api_client.get(
            _assigned_url(workspace_with_members.slug, assignee=target_user.id)
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        body = response.json()
        # Pagination envelope shape from BasePaginator: {"results": [...], ...}
        results = body.get("results", body if isinstance(body, list) else [])
        ids = {str(item["id"]) for item in results}
        assert str(in_personal.id) in ids
        assert str(in_shared.id) in ids
        # Privacy boundary
        assert len(ids) == 2, f"unexpected items leaked: {ids}"

    @pytest.mark.django_db
    def test_state_group_filter_restricts_results(
        self,
        system_api_client,
        workspace_with_members,
        create_user,
        target_user,
        shared_project_with_state,
    ):
        shared_project, todo_state = shared_project_with_state
        done_state = State.objects.create(
            name="Done",
            color="#46A758",
            project=shared_project,
            workspace=workspace_with_members,
            group=StateGroup.COMPLETED.value,
            sequence=55000,
        )

        todo_issue = _create_issue(
            shared_project,
            todo_state,
            "Todo item",
            assignees=[target_user],
            workspace=workspace_with_members,
            creator=create_user,
        )
        _create_issue(
            shared_project,
            done_state,
            "Done item",
            assignees=[target_user],
            workspace=workspace_with_members,
            creator=create_user,
        )

        response = system_api_client.get(
            _assigned_url(
                workspace_with_members.slug,
                assignee=target_user.id,
                state_group="unstarted",
            )
        )
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        results = body.get("results", body if isinstance(body, list) else [])
        ids = {str(item["id"]) for item in results}
        assert str(todo_issue.id) in ids
        assert len(ids) == 1

    @pytest.mark.django_db
    def test_empty_when_target_has_no_assignments(
        self, system_api_client, workspace_with_members, target_user
    ):
        response = system_api_client.get(
            _assigned_url(workspace_with_members.slug, assignee=target_user.id)
        )
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        results = body.get("results", body if isinstance(body, list) else [])
        assert results == []


@pytest.mark.contract
class TestAssignedWorkItemsAuditTrail:
    @pytest.mark.django_db
    def test_get_sets_acting_on_behalf_of_to_assignee(
        self, system_api_client, workspace_with_members, target_user, mocker
    ):
        spy = mocker.patch("plane.middleware.logger.process_logs.delay")
        system_api_client.get(
            _assigned_url(workspace_with_members.slug, assignee=target_user.id)
        )
        assert spy.called
        log_data = spy.call_args.kwargs.get("log_data") or spy.call_args.args[0]
        assert str(log_data["acting_on_behalf_of"]) == str(target_user.id)
