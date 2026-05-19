# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID

import pytest

from plane.app.permissions import ROLE
from plane.app.services.personal_project import get_or_create_personal_project
from plane.db.models import (
    DEFAULT_STATES,
    Project,
    ProjectIdentifier,
    ProjectMember,
    ProjectNetwork,
    User,
)
# all_state_objects exposes triage-group states that the default `objects`
# manager hides; we need it to verify the bulk_create count against
# DEFAULT_STATES (which includes Triage).
from plane.db.models.state import State


@pytest.fixture
def second_user(db):
    """A second user distinct from the conftest ``create_user``.

    Conftest's ``create_user`` leaves ``username`` at the model default (empty
    string), so any sibling user fixture in the same test MUST set a distinct
    username to avoid violating the ``users_username_key`` UNIQUE constraint.
    """
    user = User.objects.create(
        email="second@plane.so",
        username="second_user",
        first_name="Second",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


@pytest.mark.unit
class TestGetOrCreatePersonalProject:
    """Unit tests for the get-or-create personal project helper."""

    @pytest.mark.django_db
    def test_creates_personal_project_when_none_exists(self, workspace, create_user):
        """Fresh call seeds Project + ProjectIdentifier + ADMIN member + DEFAULT_STATES."""
        project = get_or_create_personal_project(workspace, create_user)

        assert project.is_personal is True
        assert project.personal_owner_id == create_user.id
        assert project.workspace_id == workspace.id
        assert project.network == ProjectNetwork.SECRET.value
        assert project.created_by_id == create_user.id

        short = str(create_user.id).replace("-", "")[:8].upper()
        assert project.identifier == f"MT{short}"[:12]
        assert project.name == f"My Tasks {short}"

        assert ProjectIdentifier.objects.filter(
            project=project, name=project.identifier, workspace_id=workspace.id
        ).exists()
        assert ProjectMember.objects.filter(
            project=project, member=create_user, role=ROLE.ADMIN.value
        ).exists()
        assert State.all_state_objects.filter(project=project).count() == len(DEFAULT_STATES)

    @pytest.mark.django_db
    def test_idempotent_returns_existing_project_on_second_call(
        self, workspace, create_user
    ):
        """Second call for the same (workspace, owner) returns the same row, no dup."""
        first = get_or_create_personal_project(workspace, create_user)
        second = get_or_create_personal_project(workspace, create_user)

        assert second.id == first.id
        assert (
            Project.objects.filter(
                workspace=workspace,
                is_personal=True,
                personal_owner=create_user,
            ).count()
            == 1
        )
        # No duplicate states / members from the second call either.
        assert (
            State.all_state_objects.filter(project=first).count()
            == len(DEFAULT_STATES)
        )
        assert (
            ProjectMember.objects.filter(project=first, member=create_user).count()
            == 1
        )

    @pytest.mark.django_db
    def test_creates_for_owner_distinct_from_actor(
        self, workspace, create_user, second_user
    ):
        """Token-API path: actor (system) creates a bucket owned by another user.

        Owner gets ``personal_owner`` + ADMIN membership; actor is recorded as
        ``created_by`` on the Project and on the seeded DEFAULT_STATES rows.
        Actor is NOT added as a member.
        """
        project = get_or_create_personal_project(
            workspace, owner=second_user, actor=create_user
        )

        assert project.personal_owner_id == second_user.id
        assert project.created_by_id == create_user.id

        assert ProjectMember.objects.filter(
            project=project, member=second_user, role=ROLE.ADMIN.value
        ).exists()
        assert not ProjectMember.objects.filter(
            project=project, member=create_user
        ).exists()

        states = State.all_state_objects.filter(project=project)
        assert states.count() == len(DEFAULT_STATES)
        for state in states:
            assert state.created_by_id == create_user.id

    @pytest.mark.django_db
    def test_identifier_collision_appends_numeric_suffix(self, workspace, create_user):
        """When the {SHORT}-derived identifier or name is already taken in this
        workspace, the helper retries with an incrementing numeric suffix."""
        # Pre-seed a colliding project that occupies the natural identifier+name
        # that get_or_create_personal_project would pick for create_user.
        short = str(create_user.id).replace("-", "")[:8].upper()
        Project.objects.create(
            name=f"My Tasks {short}",
            identifier=f"MT{short}"[:12],
            workspace=workspace,
            created_by=create_user,
        )

        # Now create a second user whose UUID derives the same SHORT, forcing
        # the collision path. We mint a UUID that shares the first 8 hex chars.
        colliding_id = UUID(str(create_user.id).replace("-", "")[:8] + "ffff" * 6)
        clone = User.objects.create(
            id=colliding_id,
            email="clone@plane.so",
            username="clone_user",
            first_name="Clone",
            last_name="User",
        )
        clone.set_password("test-password")
        clone.save()

        project = get_or_create_personal_project(workspace, clone)

        assert project.identifier == f"MT{short}1"[:12]
        assert project.name == f"My Tasks {short} 1"
