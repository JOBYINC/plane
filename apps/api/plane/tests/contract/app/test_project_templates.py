# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the workspace-templates view of projects.

A project flagged ``is_template=True``:
 - is hidden from the normal ``GET /projects/`` and ``/projects/details/`` outputs
 - is returned from ``GET /projects/templates/``
 - can be toggled via PATCH on the project detail endpoint
 - is reset to ``is_template=False`` when used as the source for
   ``POST /projects/<id>/duplicate/`` (clones aren't themselves templates)
"""

import pytest
from rest_framework import status

from plane.db.models import (
    APIToken,
    Project,
    ProjectMember,
    Workspace,
    WorkspaceMember,
)


@pytest.fixture(autouse=True)
def _no_celery(mocker):
    """ProjectViewSet.partial_update queues model_activity to kombu;
    the local test env has no broker. Same shape as test_personal_tasks."""
    for path in (
        "plane.app.views.project.base.model_activity.delay",
        "plane.app.views.project.base.webhook_activity.delay",
        "plane.api.views.project_duplicate.issue_activity.delay",
        "plane.api.views.project_duplicate.model_activity.delay",
    ):
        try:
            mocker.patch(path)
        except (AttributeError, ModuleNotFoundError):
            pass


@pytest.fixture
def templates_workspace(create_user):
    ws = Workspace.objects.create(
        name="Template Workspace",
        owner=create_user,
        slug="tpl-ws",
    )
    WorkspaceMember.objects.create(workspace=ws, member=create_user, role=20)
    return ws


@pytest.fixture
def regular_project(db, templates_workspace, create_user):
    p = Project.objects.create(
        name="Active Project",
        identifier="ACT",
        workspace=templates_workspace,
    )
    ProjectMember.objects.create(
        project=p,
        workspace=templates_workspace,
        member=create_user,
        role=20,
    )
    return p


@pytest.fixture
def template_project(db, templates_workspace, create_user):
    p = Project.objects.create(
        name="Launch Template",
        identifier="LTP",
        workspace=templates_workspace,
        is_template=True,
    )
    ProjectMember.objects.create(
        project=p,
        workspace=templates_workspace,
        member=create_user,
        role=20,
    )
    return p


def _list_detail_url(slug):
    return f"/api/workspaces/{slug}/projects/details/"


def _list_url(slug):
    return f"/api/workspaces/{slug}/projects/"


def _templates_url(slug):
    return f"/api/workspaces/{slug}/projects/templates/"


def _project_detail_url(slug, project_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/"


def _duplicate_url(slug, project_id):
    return f"/api/v1/workspaces/{slug}/projects/{project_id}/duplicate/"


@pytest.mark.contract
class TestTemplateFiltering:
    """Templates are hidden from the active-projects list but reachable
    through the dedicated templates endpoint."""

    @pytest.mark.django_db
    def test_main_list_detail_excludes_templates(
        self, session_client, templates_workspace, regular_project, template_project
    ):
        response = session_client.get(_list_detail_url(templates_workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        ids = {p["id"] for p in response.json()}
        assert str(regular_project.id) in ids
        assert str(template_project.id) not in ids, (
            "templates must not appear in the main /projects/details/ list — "
            "they belong in the dedicated /templates/ group in the sidebar"
        )

    @pytest.mark.django_db
    def test_main_list_excludes_templates(
        self, session_client, templates_workspace, regular_project, template_project
    ):
        response = session_client.get(_list_url(templates_workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        ids = {p["id"] for p in response.json()}
        assert str(regular_project.id) in ids
        assert str(template_project.id) not in ids

    @pytest.mark.django_db
    def test_templates_endpoint_returns_only_templates(
        self, session_client, templates_workspace, regular_project, template_project
    ):
        response = session_client.get(_templates_url(templates_workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        ids = {p["id"] for p in response.json()}
        assert ids == {str(template_project.id)}


@pytest.mark.contract
class TestTemplateToggle:
    """Marking a project as template (or un-marking) is a PATCH on the
    project detail endpoint — no separate route needed."""

    @pytest.mark.django_db
    def test_patch_sets_is_template(
        self, session_client, templates_workspace, regular_project
    ):
        response = session_client.patch(
            _project_detail_url(templates_workspace.slug, regular_project.id),
            data={"is_template": True},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        regular_project.refresh_from_db()
        assert regular_project.is_template is True

    @pytest.mark.django_db
    def test_patch_unsets_is_template(
        self, session_client, templates_workspace, template_project
    ):
        response = session_client.patch(
            _project_detail_url(templates_workspace.slug, template_project.id),
            data={"is_template": False},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        template_project.refresh_from_db()
        assert template_project.is_template is False


@pytest.mark.contract
class TestTemplateDuplicateResetsFlag:
    """Cloning a template via the duplicate endpoint must produce a
    regular project (``is_template=False``), not another template — or
    every duplication would multiply the sidebar group."""

    @pytest.fixture
    def system_api_client(self, api_client, create_user):
        # ProjectDuplicateEndpoint uses ProjectBasePermission which works
        # with a normal API token holder who is a project member.
        token = APIToken.objects.create(
            user=create_user,
            label="Test API Token",
            token="dup-test-api-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        return api_client

    @pytest.mark.django_db
    def test_clone_of_template_is_not_a_template(
        self, system_api_client, templates_workspace, template_project
    ):
        assert template_project.is_template is True
        response = system_api_client.post(
            _duplicate_url(templates_workspace.slug, template_project.id),
            data={"name": "Launch From Template"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])
        assert clone.is_template is False, (
            "duplicate must reset is_template on the clone, otherwise "
            "templates would multiply on every launch"
        )


@pytest.mark.contract
class TestDuplicateNetworkResolution:
    """Duplicate-endpoint network resolution:
     1. ``network`` in body → caller wins (lets "Save as template (Public)"
        vs "Save as template (Private)" pick directly).
     2. ``is_template=true`` clone with no network → default Private (0).
     3. otherwise → inherit source's network.
    """

    @pytest.fixture
    def system_api_client(self, api_client, create_user):
        token = APIToken.objects.create(
            user=create_user,
            label="Net Test API Token",
            token="dup-net-test-api-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        return api_client

    @pytest.fixture
    def public_source(self, db, templates_workspace, create_user):
        # Force network=2 (Public) so the inheritance branch is visible
        # against the new model default of 0.
        p = Project.objects.create(
            name="Public Source",
            identifier="PUB",
            workspace=templates_workspace,
            network=2,
        )
        ProjectMember.objects.create(
            project=p,
            workspace=templates_workspace,
            member=create_user,
            role=20,
        )
        return p

    @pytest.mark.django_db
    def test_body_network_explicit_public_wins(
        self, system_api_client, templates_workspace, regular_project
    ):
        """is_template=true + network=2 in body → clone is Public."""
        response = system_api_client.post(
            _duplicate_url(templates_workspace.slug, regular_project.id),
            data={"name": "Public Template", "is_template": True, "network": 2},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])
        assert clone.is_template is True
        assert clone.network == 2

    @pytest.mark.django_db
    def test_save_as_template_defaults_private(
        self, system_api_client, templates_workspace, public_source
    ):
        """is_template=true with no explicit network → defaults Private (0)
        even though source is Public — templates start private by default
        (matches project-default shipped in migration 0130)."""
        assert public_source.network == 2
        response = system_api_client.post(
            _duplicate_url(templates_workspace.slug, public_source.id),
            data={"name": "Template Default Private", "is_template": True},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])
        assert clone.is_template is True
        assert clone.network == 0

    @pytest.mark.django_db
    def test_launch_from_template_inherits_source_network(
        self, system_api_client, templates_workspace, public_source
    ):
        """Non-template clone with no body network → inherits source's
        network (e.g. "Create launch from Public template" stays Public
        unless the caller overrides)."""
        assert public_source.network == 2
        response = system_api_client.post(
            _duplicate_url(templates_workspace.slug, public_source.id),
            data={"name": "Launch Inheriting Network"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])
        assert clone.is_template is False
        assert clone.network == 2

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "bad_value",
        ["private", "public", 1, 3, -1, "abc"],
    )
    def test_invalid_network_rejected_400(
        self, system_api_client, templates_workspace, regular_project, bad_value
    ):
        """Anything outside {0, 2} must 400. Django `choices` are NOT
        enforced on raw model.save(), so without an explicit guard the
        clone would silently save garbage (e.g. network=1 — not a valid
        ProjectNetwork)."""
        before = Project.objects.count()
        response = system_api_client.post(
            _duplicate_url(templates_workspace.slug, regular_project.id),
            data={"name": "Bad Network Clone", "network": bad_value},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.content
        assert Project.objects.count() == before, "no clone should be created on 400"


@pytest.mark.contract
class TestDuplicatePrivateSourceGate:
    """Pre-existing duplicate POST permission is workspace-level only —
    a workspace MEMBER who learns a private project's UUID could otherwise
    duplicate it without being a project member, bypassing the privacy
    model shipped in migration 0130. The view now adds a project-level
    gate when source.network=Secret (0)."""

    @pytest.fixture
    def other_user(self, db, django_user_model):
        return django_user_model.objects.create_user(
            username="other-member@example.com",
            email="other-member@example.com",
            password="x" * 12,
        )

    @pytest.fixture
    def other_member_client(self, api_client, other_user, templates_workspace):
        # other_user is workspace MEMBER (role=15) but NOT a project member.
        WorkspaceMember.objects.create(
            workspace=templates_workspace,
            member=other_user,
            role=15,
        )
        token = APIToken.objects.create(
            user=other_user,
            label="Other Member API Token",
            token="dup-other-member-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        return api_client

    @pytest.fixture
    def private_source(self, db, templates_workspace, create_user):
        """A Secret/private project that `create_user` (workspace owner)
        is an ADMIN member of, but `other_user` is not."""
        p = Project.objects.create(
            name="Private Source",
            identifier="PRV",
            workspace=templates_workspace,
            network=0,
        )
        ProjectMember.objects.create(
            project=p,
            workspace=templates_workspace,
            member=create_user,
            role=20,
        )
        return p

    @pytest.mark.django_db
    def test_non_member_cannot_duplicate_private_source(
        self, other_member_client, templates_workspace, private_source
    ):
        """Workspace MEMBER who isn't a project member must 403 on a
        private source — even though they pass ProjectBasePermission."""
        before = Project.objects.count()
        response = other_member_client.post(
            _duplicate_url(templates_workspace.slug, private_source.id),
            data={"name": "Sneaky Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
        assert Project.objects.count() == before

    @pytest.mark.django_db
    def test_workspace_admin_can_duplicate_private_source(
        self, api_client, other_user, templates_workspace, private_source
    ):
        """Workspace ADMIN who isn't a project member still gets through —
        admins see/touch every project per the list view's filter."""
        WorkspaceMember.objects.create(
            workspace=templates_workspace,
            member=other_user,
            role=20,
        )
        token = APIToken.objects.create(
            user=other_user,
            label="WS Admin Token",
            token="dup-ws-admin-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        response = api_client.post(
            _duplicate_url(templates_workspace.slug, private_source.id),
            data={"name": "Admin Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content

    @pytest.mark.django_db
    def test_public_source_unchanged_by_gate(
        self, api_client, other_user, templates_workspace, create_user
    ):
        """The new gate only fires on Secret sources. Public sources keep
        the pre-existing workspace-level check (any MEMBER can duplicate)."""
        public_project = Project.objects.create(
            name="Public Source",
            identifier="PUB",
            workspace=templates_workspace,
            network=2,
        )
        ProjectMember.objects.create(
            project=public_project,
            workspace=templates_workspace,
            member=create_user,
            role=20,
        )
        WorkspaceMember.objects.create(
            workspace=templates_workspace,
            member=other_user,
            role=15,
        )
        token = APIToken.objects.create(
            user=other_user,
            label="Public Source Member Token",
            token="dup-pub-src-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        response = api_client.post(
            _duplicate_url(templates_workspace.slug, public_project.id),
            data={"name": "Public Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
