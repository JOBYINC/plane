# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the project duplicate endpoint
(``POST /api/v1/workspaces/{slug}/projects/{project_id}/duplicate/``).

Acceptance bar per the feature spec: per-row per-field equality on the
clone, not just structural counts. Mirrors the assertions in §4 of
``agents/_inbox/plane-project-clone-feature-request.md``.
"""

from datetime import date, timedelta

import pytest
from rest_framework import status

from plane.db.models import (
    APIToken,
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    IssueRelation,
    Label,
    Module,
    ModuleIssue,
    ModuleMember,
    Project,
    ProjectMember,
    State,
    User,
    WorkItemField,
    WorkItemFieldOption,
    WorkItemFieldValue,
    Workspace,
    WorkspaceMember,
)


@pytest.fixture(autouse=True)
def _no_celery(mocker):
    """The clone path queues no celery work itself, but the underlying
    ``Project`` / ``Issue`` / ``ProjectMember`` ``save()`` overrides can
    trigger signal-driven background tasks that the local test env can't
    route. Defensive blanket-mock matches the personal-tasks fixture."""
    for path in (
        "plane.api.views.project_duplicate.issue_activity.delay",
        "plane.api.views.project_duplicate.model_activity.delay",
    ):
        try:
            mocker.patch(path)
        except (AttributeError, ModuleNotFoundError):
            # Helper isn't imported by the view → nothing to mock.
            pass


@pytest.fixture
def second_user(db):
    user = User.objects.create(
        email="member@plane.so",
        username="member_user",
        first_name="Member",
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


@pytest.fixture
def duplicate_workspace(create_user, second_user):
    workspace = Workspace.objects.create(
        name="Duplicate Test Workspace",
        owner=create_user,
        slug="dup-workspace",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=create_user, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=second_user, role=15)
    return workspace


@pytest.fixture
def source_project(db, duplicate_workspace, create_user, second_user):
    """Minimal but topologically complete source: every entity type that
    the duplicate endpoint must clone is present at least once, with at
    least one cross-entity reference (issue → state, issue → label, etc.)
    so per-field equality checks have something to anchor on."""
    project = Project.objects.create(
        name="Template Project",
        identifier="TPL",
        workspace=duplicate_workspace,
        module_view=True,
        cycle_view=True,
        external_source="asana-tick",
        external_id="TPL:source",
    )

    state = State.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Todo",
        color="#888888",
        group="unstarted",
        default=True,
    )

    label = Label.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="urgent-red",
        color="#ff0000",
    )

    cycle = Cycle.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Sprint 1",
        owned_by=create_user,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 15),
    )

    module = Module.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Channel A",
        lead=create_user,
    )
    ModuleMember.objects.create(
        module=module,
        member=second_user,
        project=project,
        workspace=duplicate_workspace,
    )

    field = WorkItemField.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Tier",
        field_type=WorkItemField.FieldType.SINGLE_SELECT,
    )
    option_ps = WorkItemFieldOption.objects.create(
        project=project,
        workspace=duplicate_workspace,
        field=field,
        name="PS",
        color="#aa00ff",
    )
    WorkItemFieldOption.objects.create(
        project=project,
        workspace=duplicate_workspace,
        field=field,
        name="S",
        color="#00aaff",
    )

    ProjectMember.objects.create(
        project=project,
        workspace=duplicate_workspace,
        member=create_user,
        role=20,
    )
    ProjectMember.objects.create(
        project=project,
        workspace=duplicate_workspace,
        member=second_user,
        role=15,
    )

    parent_issue = Issue.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Parent task",
        description_html="<p>parent body</p>",
        priority="high",
        target_date=date(2026, 1, 10),
        state=state,
        external_source="asana-tick",
        external_id="TPL:parent-1",
    )
    sub_issue = Issue.objects.create(
        project=project,
        workspace=duplicate_workspace,
        name="Sub task",
        description_html="<p>sub body</p>",
        priority="low",
        target_date=date(2026, 1, 12),
        state=state,
        parent=parent_issue,
        external_source="asana-tick",
        external_id="TPL:sub-1",
    )

    IssueAssignee.objects.create(
        issue=parent_issue,
        assignee=second_user,
        project=project,
        workspace=duplicate_workspace,
    )
    IssueLabel.objects.create(
        issue=parent_issue,
        label=label,
        project=project,
        workspace=duplicate_workspace,
    )
    ModuleIssue.objects.create(
        issue=parent_issue,
        module=module,
        project=project,
        workspace=duplicate_workspace,
    )
    CycleIssue.objects.create(
        issue=parent_issue,
        cycle=cycle,
        project=project,
        workspace=duplicate_workspace,
    )
    WorkItemFieldValue.objects.create(
        issue=parent_issue,
        field=field,
        project=project,
        workspace=duplicate_workspace,
        value_text=str(option_ps.id),
    )

    IssueRelation.objects.create(
        issue=parent_issue,
        related_issue=sub_issue,
        relation_type="blocked_by",
        project=project,
        workspace=duplicate_workspace,
    )

    return project


def _duplicate_url(slug, project_id):
    return f"/api/v1/workspaces/{slug}/projects/{project_id}/duplicate/"


@pytest.mark.contract
class TestProjectDuplicateHappyPath:
    """The acceptance bar from §4: per-row per-field equality, not counts."""

    @pytest.mark.django_db
    def test_clone_returns_201_with_new_project_id(
        self, api_key_client, duplicate_workspace, source_project, create_user
    ):
        # api_key_client's user (create_user) must be a project member to pass
        # ProjectBasePermission. The fixture creates that via source_project.
        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={
                "name": "Cloned Project",
                "rebump_target_dates_by_days": 4,
                "rebump_cycle_windows_by_days": 4,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        body = response.json()
        assert "id" in body
        assert body["id"] != str(source_project.id)
        assert body["name"] == "Cloned Project"

    @pytest.mark.django_db
    def test_clone_per_field_equality_on_all_child_entities(
        self,
        api_key_client,
        duplicate_workspace,
        source_project,
        create_user,
        second_user,
    ):
        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={
                "name": "Cloned Project",
                "rebump_target_dates_by_days": 4,
                "rebump_cycle_windows_by_days": 4,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone_id = response.json()["id"]
        clone = Project.objects.get(pk=clone_id)

        # Project metadata
        assert clone.module_view == source_project.module_view
        assert clone.cycle_view == source_project.cycle_view
        assert clone.workspace_id == source_project.workspace_id
        assert clone.id != source_project.id

        # State
        states = State.objects.filter(project=clone)
        assert states.count() == 1
        cs = states.first()
        ss = source_project.project_state.first()
        assert cs.name == ss.name
        assert cs.color == ss.color
        assert cs.group == ss.group
        assert cs.default == ss.default
        assert cs.id != ss.id

        # Label
        labels = Label.objects.filter(project=clone)
        assert labels.count() == 1
        assert labels.first().name == "urgent-red"
        assert labels.first().color == "#ff0000"

        # Cycle — dates shifted by +4 days
        cycles = Cycle.objects.filter(project=clone)
        assert cycles.count() == 1
        cc = cycles.first()
        sc = source_project.project_cycle.first()
        assert cc.name == sc.name
        assert cc.start_date.date() == sc.start_date.date() + timedelta(days=4)
        assert cc.end_date.date() == sc.end_date.date() + timedelta(days=4)

        # Module + ModuleMember
        modules = Module.objects.filter(project=clone)
        assert modules.count() == 1
        cm = modules.first()
        sm = source_project.project_module.first()
        assert cm.name == sm.name
        assert cm.lead_id == sm.lead_id
        clone_module_members = ModuleMember.objects.filter(module=cm)
        source_module_members = ModuleMember.objects.filter(module=sm)
        assert {m.member_id for m in clone_module_members} == {
            m.member_id for m in source_module_members
        }

        # Custom field schema + options
        fields = WorkItemField.objects.filter(project=clone)
        assert fields.count() == 1
        cf = fields.first()
        sf = source_project.project_workitemfield.first()
        assert cf.name == sf.name
        assert cf.field_type == sf.field_type
        clone_options = WorkItemFieldOption.objects.filter(field=cf).order_by("name")
        source_options = WorkItemFieldOption.objects.filter(field=sf).order_by("name")
        assert [o.name for o in clone_options] == [o.name for o in source_options]

        # Project members
        clone_members = {m.member_id for m in ProjectMember.objects.filter(project=clone)}
        source_members = {
            m.member_id for m in ProjectMember.objects.filter(project=source_project)
        }
        assert clone_members == source_members

        # Issues (parent + sub)
        clone_issues = Issue.objects.filter(project=clone).order_by("name")
        assert clone_issues.count() == 2
        clone_parent = clone_issues.get(name="Parent task")
        clone_sub = clone_issues.get(name="Sub task")
        source_parent = source_project.project_issue.get(name="Parent task")
        source_sub = source_project.project_issue.get(name="Sub task")

        # Parent invariants
        assert clone_parent.description_html == source_parent.description_html
        assert clone_parent.priority == source_parent.priority
        assert clone_parent.target_date == source_parent.target_date + timedelta(days=4)
        assert clone_parent.state_id == cs.id  # mapped to clone's state
        assert clone_parent.state_id != source_parent.state_id

        # Sub invariants — parent remapped
        assert clone_sub.parent_id == clone_parent.id
        assert clone_sub.parent_id != source_sub.parent_id
        assert clone_sub.target_date == source_sub.target_date + timedelta(days=4)

        # Issue → assignee (parent has second_user as assignee)
        parent_assignees = set(
            IssueAssignee.objects.filter(issue=clone_parent).values_list(
                "assignee_id", flat=True
            )
        )
        assert parent_assignees == {second_user.id}

        # Issue → label
        parent_labels = set(
            IssueLabel.objects.filter(issue=clone_parent).values_list(
                "label_id", flat=True
            )
        )
        assert parent_labels == {labels.first().id}

        # Issue → module attachment (via clone's module UUID, not source's)
        parent_module_ids = set(
            ModuleIssue.objects.filter(issue=clone_parent).values_list(
                "module_id", flat=True
            )
        )
        assert parent_module_ids == {cm.id}

        # Issue → cycle attachment
        parent_cycle_ids = set(
            CycleIssue.objects.filter(issue=clone_parent).values_list(
                "cycle_id", flat=True
            )
        )
        assert parent_cycle_ids == {cc.id}

        # Custom field values — option UUID remapped
        cfv = WorkItemFieldValue.objects.get(issue=clone_parent, field=cf)
        # cfv.value_text holds the option UUID as a string — must point at the
        # CLONE's PS option, not the source's
        clone_ps_option = WorkItemFieldOption.objects.get(field=cf, name="PS")
        assert cfv.value_text == str(clone_ps_option.id)

        # IssueRelation (blocked_by) — both endpoints remapped to clone issues
        clone_relations = IssueRelation.objects.filter(project=clone)
        assert clone_relations.count() == 1
        rel = clone_relations.first()
        assert rel.issue_id == clone_parent.id
        assert rel.related_issue_id == clone_sub.id
        assert rel.relation_type == "blocked_by"


@pytest.mark.contract
class TestProjectDuplicateOverrides:
    """v1 overrides: override_custom_field_values is the load-bearing one
    per §6 — it removes the per-issue PATCH loop for setting Tier."""

    @pytest.mark.django_db
    def test_override_custom_field_value_by_field_name(
        self,
        api_key_client,
        duplicate_workspace,
        source_project,
        create_user,
    ):
        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        # Source's Tier value on Parent task is "PS"; override to "S" on the clone.
        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={
                "name": "Cloned Project for Override",
                "override_custom_field_values": {"Tier": "S"},
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone_id = response.json()["id"]
        clone = Project.objects.get(pk=clone_id)

        clone_field = WorkItemField.objects.get(project=clone, name="Tier")
        clone_s_option = WorkItemFieldOption.objects.get(field=clone_field, name="S")
        clone_parent = Issue.objects.get(project=clone, name="Parent task")
        cfv = WorkItemFieldValue.objects.get(issue=clone_parent, field=clone_field)
        # Every issue in the clone should have its Tier set to S, not the
        # source's PS value — this is the "no per-issue PATCH loop" promise.
        assert cfv.value_text == str(clone_s_option.id)


@pytest.mark.contract
class TestProjectDuplicateExternalIdRemap:
    """§3 last row: child external_ids prefix-swap from source to clone.

    Default behaviour (no new external_id given): children get null. With
    a new external_id, the leading ``<prefix>:`` segment is rewritten.
    """

    @pytest.mark.django_db
    def test_no_new_external_id_nulls_child_external_ids(
        self, api_key_client, duplicate_workspace, source_project, create_user
    ):
        # Seed a cycle / module / issue with non-null external_ids
        cycle = source_project.project_cycle.first()
        cycle.external_id = "TPL:cycle:Sprint1"
        cycle.external_source = "asana-tick"
        cycle.save()

        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={"name": "No External Id Clone"},  # no external_id in body
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone_id = response.json()["id"]
        clone = Project.objects.get(pk=clone_id)

        clone_cycle = Cycle.objects.get(project=clone)
        assert clone_cycle.external_id is None, (
            "no new external_id → child external_ids must be nulled to avoid"
            " uniqueness collision on a future re-clone"
        )

    @pytest.mark.django_db
    def test_new_external_id_rewrites_prefix_on_children(
        self, api_key_client, duplicate_workspace, source_project, create_user
    ):
        cycle = source_project.project_cycle.first()
        cycle.external_id = "TPL:cycle:Sprint1"
        cycle.external_source = "asana-tick"
        cycle.save()
        issue = source_project.project_issue.get(name="Parent task")
        issue.external_id = "TPL:parent-1"
        issue.save()

        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={
                "name": "Prefix Remap Clone",
                "external_id": "GP02:2026-07-21",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone_id = response.json()["id"]
        clone = Project.objects.get(pk=clone_id)

        clone_cycle = Cycle.objects.get(project=clone)
        assert clone_cycle.external_id == "GP02:cycle:Sprint1", (
            f"expected prefix-swap to GP02:, got {clone_cycle.external_id!r}"
        )
        clone_parent = Issue.objects.get(project=clone, name="Parent task")
        assert clone_parent.external_id == "GP02:parent-1"


@pytest.mark.contract
class TestProjectDuplicateAtomicity:
    """§5: the whole clone is one transaction — any exception rolls back
    everything, no orphan project/issues/etc."""

    @pytest.mark.django_db
    def test_failure_mid_clone_rolls_back_project_record(
        self,
        api_key_client,
        duplicate_workspace,
        source_project,
        create_user,
        mocker,
    ):
        ProjectMember.objects.get_or_create(
            project=source_project,
            workspace=duplicate_workspace,
            member=create_user,
            defaults={"role": 20},
        )

        before_project_count = Project.objects.filter(
            workspace=duplicate_workspace
        ).count()
        before_issue_count = Issue.objects.filter(workspace=duplicate_workspace).count()

        # Inject a failure deep in the clone — relation copy is the last
        # step, so by that point states/labels/cycles/modules/issues are
        # all written. If atomic rollback works, none of those persist.
        mocker.patch(
            "plane.api.views.project_duplicate.ProjectDuplicateEndpoint._clone_issue_relations",
            side_effect=RuntimeError("boom"),
        )

        response = api_key_client.post(
            _duplicate_url(duplicate_workspace.slug, source_project.id),
            data={"name": "Will Roll Back"},
            format="json",
        )
        assert response.status_code >= 400

        after_project_count = Project.objects.filter(
            workspace=duplicate_workspace
        ).count()
        after_issue_count = Issue.objects.filter(workspace=duplicate_workspace).count()
        assert after_project_count == before_project_count, (
            "Partial clone project leaked despite mid-clone exception — atomicity broken"
        )
        assert after_issue_count == before_issue_count
