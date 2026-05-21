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
