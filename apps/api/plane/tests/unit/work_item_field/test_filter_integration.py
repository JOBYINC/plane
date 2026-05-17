# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Live-DB integration test for the §8 custom-field filter wiring.

Closes the exact concern the design gated: applying
build_custom_field_filter() through the real Issue queryset over the
``field_values`` reverse FK must (a) return the right issues and
(b) NOT duplicate Issue rows. These queries deliberately do *not* call
.distinct() so the no-dupe guarantee is proven structurally (single
combined Q + the (issue, field, deleted_at) partial unique index),
matching how plane/app/views/issue/base.py wires it (which additionally
.distinct()s as belt-and-suspenders).

Requires a real Postgres (ArrayField). Run locally against an ephemeral
pgserver DB; CI runs it against its Postgres. See
[[project-api-local-verify-no-docker]].
"""

import pytest

from plane.app.views.work_item_field.filters import build_custom_field_filter
from plane.db.models import Issue, WorkItemField, WorkItemFieldValue
from plane.tests.factories import (
    ProjectFactory,
    ProjectMemberFactory,
    UserFactory,
    WorkspaceFactory,
    WorkspaceMemberFactory,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def project_graph():
    user = UserFactory()
    workspace = WorkspaceFactory(owner=user)
    WorkspaceMemberFactory(workspace=workspace, member=user)
    project = ProjectFactory(workspace=workspace)
    ProjectMemberFactory(project=project, member=user)

    issues = [
        Issue.objects.create(
            name=f"Issue {n}",
            project=project,
            workspace=workspace,
            created_by=user,
            sequence_id=n,
        )
        for n in (1, 2, 3)
    ]
    return user, workspace, project, issues


def _ids(queryset):
    # No .distinct() on purpose — proves the join itself doesn't dupe.
    return list(queryset.values_list("id", flat=True))


class TestCustomFieldFilterLiveQueryset:
    def test_text_equality_filters_and_does_not_duplicate(self, project_graph):
        user, workspace, project, issues = project_graph
        field = WorkItemField.objects.create(
            project=project,
            workspace=workspace,
            created_by=user,
            name="Team",
            field_type=WorkItemField.FieldType.TEXT,
        )
        for issue, val in zip(issues, ["alpha", "alpha", "beta"]):
            WorkItemFieldValue.objects.create(
                issue=issue,
                field=field,
                project=project,
                workspace=workspace,
                created_by=user,
                value_text=val,
            )

        params = {
            "field_values__field_id": str(field.id),
            "field_values__value_text": "alpha",
        }
        qs = Issue.issue_objects.filter(project=project).filter(
            build_custom_field_filter(params)
        )
        ids = _ids(qs)

        assert set(ids) == {issues[0].id, issues[1].id}  # beta excluded
        assert len(ids) == len(set(ids)) == 2  # no duplicate Issue rows

    def test_absent_field_id_is_inert_returns_all(self, project_graph):
        _, _, project, issues = project_graph
        qs = Issue.issue_objects.filter(project=project).filter(
            build_custom_field_filter({})
        )
        assert set(_ids(qs)) == {i.id for i in issues}

    def test_number_gte_pushes_predicate_to_db(self, project_graph):
        user, workspace, project, issues = project_graph
        field = WorkItemField.objects.create(
            project=project,
            workspace=workspace,
            created_by=user,
            name="Score",
            field_type=WorkItemField.FieldType.NUMBER,
        )
        for issue, val in zip(issues, [5, 10, 15]):
            WorkItemFieldValue.objects.create(
                issue=issue,
                field=field,
                project=project,
                workspace=workspace,
                created_by=user,
                value_number=val,
            )

        params = {
            "field_values__field_id": str(field.id),
            "field_values__value_number__gte": "10",
        }
        qs = Issue.issue_objects.filter(project=project).filter(
            build_custom_field_filter(params)
        )
        ids = _ids(qs)

        assert set(ids) == {issues[1].id, issues[2].id}
        assert len(ids) == len(set(ids)) == 2

    def test_filter_is_scoped_to_its_field_not_other_fields(self, project_graph):
        # Two fields; a value on field B must not leak into a field-A filter.
        user, workspace, project, issues = project_graph
        field_a = WorkItemField.objects.create(
            project=project,
            workspace=workspace,
            created_by=user,
            name="A",
            field_type=WorkItemField.FieldType.TEXT,
        )
        field_b = WorkItemField.objects.create(
            project=project,
            workspace=workspace,
            created_by=user,
            name="B",
            field_type=WorkItemField.FieldType.TEXT,
        )
        WorkItemFieldValue.objects.create(
            issue=issues[0],
            field=field_a,
            project=project,
            workspace=workspace,
            created_by=user,
            value_text="match",
        )
        WorkItemFieldValue.objects.create(
            issue=issues[1],
            field=field_b,
            project=project,
            workspace=workspace,
            created_by=user,
            value_text="match",
        )

        params = {
            "field_values__field_id": str(field_a.id),
            "field_values__value_text": "match",
        }
        qs = Issue.issue_objects.filter(project=project).filter(
            build_custom_field_filter(params)
        )
        ids = _ids(qs)

        assert set(ids) == {issues[0].id}  # issues[1]'s field_B value excluded
        assert len(ids) == 1
