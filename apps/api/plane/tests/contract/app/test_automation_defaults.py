# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the default-automation-rule bootstrap path.

Covers:
 - ``create_default_automation_rules_for_project`` is idempotent — safe
   to call on a fully-installed project, a partially-installed project,
   and a brand-new project.
 - The ``backfill_default_automation_rules`` management command walks
   every non-archived project (active, template, personal) and only
   fills missing rules. Archived projects are skipped.
 - ``ProjectDuplicateEndpoint`` carries source's automation rules onto
   the clone AND backfills any missing defaults, so a launch cloned
   from a template predating the default-rule rollout still ends up
   with the 4 standard rules.
"""

import io

import pytest
from django.core.management import call_command
from rest_framework import status

from plane.db.models import (
    APIToken,
    AutomationRule,
    Project,
    ProjectMember,
    Workspace,
    WorkspaceMember,
)
from plane.utils.automation_templates import (
    DEFAULT_AUTOMATION_RULES,
    create_default_automation_rules_for_project,
)


DEFAULT_RULE_NAMES = {tpl["name"] for tpl in DEFAULT_AUTOMATION_RULES}


@pytest.fixture(autouse=True)
def _no_celery(mocker):
    """ProjectDuplicateEndpoint enqueues issue_activity / model_activity
    via celery; tests don't have a broker."""
    for path in (
        "plane.api.views.project_duplicate.issue_activity.delay",
        "plane.api.views.project_duplicate.model_activity.delay",
        "plane.app.views.project.base.model_activity.delay",
        "plane.app.views.project.base.webhook_activity.delay",
    ):
        try:
            mocker.patch(path)
        except (AttributeError, ModuleNotFoundError):
            pass


@pytest.fixture
def automation_workspace(create_user):
    ws = Workspace.objects.create(name="Auto WS", owner=create_user, slug="auto-ws")
    WorkspaceMember.objects.create(workspace=ws, member=create_user, role=20)
    return ws


def _make_project(ws, *, name, identifier, **kwargs):
    return Project.objects.create(name=name, identifier=identifier, workspace=ws, **kwargs)


@pytest.mark.contract
class TestBootstrapIdempotency:
    @pytest.mark.django_db
    def test_empty_project_installs_all_four(self, automation_workspace):
        p = _make_project(automation_workspace, name="Empty", identifier="EMP")
        installed = create_default_automation_rules_for_project(p)
        assert installed == 4
        names = set(AutomationRule.objects.filter(project=p).values_list("name", flat=True))
        assert names == DEFAULT_RULE_NAMES

    @pytest.mark.django_db
    def test_fully_installed_project_installs_none(self, automation_workspace):
        p = _make_project(automation_workspace, name="Full", identifier="FUL")
        create_default_automation_rules_for_project(p)
        # Second call must not duplicate.
        installed = create_default_automation_rules_for_project(p)
        assert installed == 0
        assert AutomationRule.objects.filter(project=p).count() == 4

    @pytest.mark.django_db
    def test_partial_project_fills_only_missing(self, automation_workspace):
        p = _make_project(automation_workspace, name="Partial", identifier="PAR")
        # Pre-seed only one default rule.
        seed = DEFAULT_AUTOMATION_RULES[0]
        AutomationRule.objects.create(
            project=p,
            workspace=automation_workspace,
            name=seed["name"],
            description=seed["description"],
            trigger_type=seed["trigger_type"],
            trigger_config=seed["trigger_config"],
            conditions=seed["conditions"],
            actions=seed["actions"],
            is_active=seed.get("is_active", True),
        )
        installed = create_default_automation_rules_for_project(p)
        assert installed == 3
        assert AutomationRule.objects.filter(project=p).count() == 4

    @pytest.mark.django_db
    def test_user_custom_rules_do_not_collide(self, automation_workspace):
        """A user-named rule must not block defaults — only ``name``
        matches count as 'already installed'."""
        p = _make_project(automation_workspace, name="Custom", identifier="CST")
        AutomationRule.objects.create(
            project=p,
            workspace=automation_workspace,
            name="My custom rule",
            trigger_type="state_changed",
            trigger_config={},
            conditions=[],
            actions=[],
            is_active=True,
        )
        installed = create_default_automation_rules_for_project(p)
        assert installed == 4
        assert AutomationRule.objects.filter(project=p).count() == 5  # 1 custom + 4 defaults


@pytest.mark.contract
class TestBackfillManagementCommand:
    @pytest.mark.django_db
    def test_backfill_installs_on_active_template_personal(self, automation_workspace, create_user):
        active = _make_project(automation_workspace, name="Active", identifier="ACT")
        template = _make_project(
            automation_workspace, name="Template", identifier="TPL", is_template=True
        )
        personal = _make_project(
            automation_workspace,
            name="My Tasks DEADBEEF",
            identifier="MTDB",
            is_personal=True,
            personal_owner=create_user,
        )
        # All three should be backfilled.
        out = io.StringIO()
        call_command("backfill_default_automation_rules", stdout=out)

        for p in (active, template, personal):
            assert AutomationRule.objects.filter(project=p).count() == 4, (
                f"{p.name} ({p.id}) should have 4 default rules"
            )
        assert "Installed rules on 3 project(s)" in out.getvalue()

    @pytest.mark.django_db
    def test_backfill_skips_archived(self, automation_workspace):
        from django.utils import timezone

        archived = _make_project(
            automation_workspace,
            name="Archived",
            identifier="ARC",
            archived_at=timezone.now(),
        )
        call_command("backfill_default_automation_rules", stdout=io.StringIO())
        assert AutomationRule.objects.filter(project=archived).count() == 0

    @pytest.mark.django_db
    def test_backfill_idempotent_on_rerun(self, automation_workspace):
        p = _make_project(automation_workspace, name="Idem", identifier="IDM")
        call_command("backfill_default_automation_rules", stdout=io.StringIO())
        assert AutomationRule.objects.filter(project=p).count() == 4
        # Second run: must not duplicate.
        call_command("backfill_default_automation_rules", stdout=io.StringIO())
        assert AutomationRule.objects.filter(project=p).count() == 4

    @pytest.mark.django_db
    def test_backfill_dry_run_does_not_write(self, automation_workspace):
        p = _make_project(automation_workspace, name="Dry", identifier="DRY")
        out = io.StringIO()
        call_command("backfill_default_automation_rules", "--dry-run", stdout=out)
        assert AutomationRule.objects.filter(project=p).count() == 0
        assert "Would install rules on 1 project(s)" in out.getvalue()


@pytest.mark.contract
class TestDuplicateCarriesRules:
    @pytest.fixture
    def system_api_client(self, api_client, automation_workspace, create_user):
        token = APIToken.objects.create(
            user=create_user,
            label="Auto Test Token",
            token="auto-dup-test-token-12345",
        )
        api_client.credentials(HTTP_X_API_KEY=token.token)
        return api_client

    def _duplicate_url(self, slug, project_id):
        return f"/api/v1/workspaces/{slug}/projects/{project_id}/duplicate/"

    @pytest.mark.django_db
    def test_duplicate_carries_source_rules_and_backfills_defaults(
        self, system_api_client, automation_workspace, create_user
    ):
        source = _make_project(automation_workspace, name="Source", identifier="SRC")
        ProjectMember.objects.create(
            project=source,
            workspace=automation_workspace,
            member=create_user,
            role=20,
        )
        # Source has only 1 default + 1 custom rule. After clone, the
        # clone should have: source's 2 rules + the 3 missing defaults.
        seed = DEFAULT_AUTOMATION_RULES[0]
        AutomationRule.objects.create(
            project=source,
            workspace=automation_workspace,
            name=seed["name"],
            description=seed["description"],
            trigger_type=seed["trigger_type"],
            trigger_config=seed["trigger_config"],
            conditions=seed["conditions"],
            actions=seed["actions"],
            is_active=True,
        )
        AutomationRule.objects.create(
            project=source,
            workspace=automation_workspace,
            name="Marcus's custom rule",
            trigger_type="comment_added",
            trigger_config={},
            conditions=[],
            actions=[],
            is_active=True,
        )

        response = system_api_client.post(
            self._duplicate_url(automation_workspace.slug, source.id),
            data={"name": "Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])

        clone_names = set(
            AutomationRule.objects.filter(project=clone).values_list("name", flat=True)
        )
        # All 4 defaults present.
        assert DEFAULT_RULE_NAMES.issubset(clone_names)
        # Custom rule carried over.
        assert "Marcus's custom rule" in clone_names
        # No duplicates: total = 4 defaults + 1 custom = 5.
        assert AutomationRule.objects.filter(project=clone).count() == 5

    @pytest.mark.django_db
    def test_duplicate_remaps_state_and_label_uuids(
        self, system_api_client, automation_workspace, create_user
    ):
        """Source-scoped state_id / label_id inside trigger_config /
        conditions / actions must be rewritten to the clone's
        equivalents — otherwise the engine's project-scoped state
        resolver (see automation_engine_task._resolve_state) trips
        state_not_found on every fire."""
        from plane.db.models import Label, State

        source = _make_project(automation_workspace, name="Mapped Source", identifier="MSR")
        ProjectMember.objects.create(
            project=source, workspace=automation_workspace, member=create_user, role=20
        )
        # Source-scoped state + label.
        src_state_in = State.objects.create(
            name="InProgress", color="#fff", group="started",
            project=source, workspace=automation_workspace, sequence=1,
        )
        src_state_out = State.objects.create(
            name="Done", color="#000", group="completed",
            project=source, workspace=automation_workspace, sequence=2,
        )
        src_label = Label.objects.create(
            name="bug", color="#f00", project=source, workspace=automation_workspace,
        )

        # A rule that references all the project-scoped IDs we remap.
        AutomationRule.objects.create(
            project=source,
            workspace=automation_workspace,
            name="UUID-heavy rule",
            trigger_type="state_changed",
            trigger_config={
                "from_state_ids": [str(src_state_in.id)],
                "to_state_ids": [str(src_state_out.id)],
            },
            conditions=[
                {"field": "state", "op": "eq", "value": str(src_state_in.id)},
                {"field": "label_ids", "op": "in", "value": [str(src_label.id)]},
            ],
            actions=[
                {"type": "set_state", "config": {"state_id": str(src_state_out.id)}},
                {"type": "add_label", "config": {"label_id": str(src_label.id)}},
            ],
            is_active=True,
        )

        response = system_api_client.post(
            self._duplicate_url(automation_workspace.slug, source.id),
            data={"name": "Mapped Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])

        cloned_rule = AutomationRule.objects.get(project=clone, name="UUID-heavy rule")

        # Every source UUID must be remapped to a clone-scoped one (or
        # at minimum, NOT equal to the source's). Easier check: pull the
        # clone-scoped state/label UUIDs and verify the rule points at
        # exactly those.
        clone_state_in = State.objects.get(project=clone, name="InProgress")
        clone_state_out = State.objects.get(project=clone, name="Done")
        clone_label = Label.objects.get(project=clone, name="bug")

        assert cloned_rule.trigger_config == {
            "from_state_ids": [str(clone_state_in.id)],
            "to_state_ids": [str(clone_state_out.id)],
        }
        assert cloned_rule.conditions == [
            {"field": "state", "op": "eq", "value": str(clone_state_in.id)},
            {"field": "label_ids", "op": "in", "value": [str(clone_label.id)]},
        ]
        assert cloned_rule.actions == [
            {"type": "set_state", "config": {"state_id": str(clone_state_out.id)}},
            {"type": "add_label", "config": {"label_id": str(clone_label.id)}},
        ]

        # Sanity: NONE of the source UUIDs leaked through.
        for ref in [src_state_in.id, src_state_out.id, src_label.id]:
            assert str(ref) not in str(cloned_rule.trigger_config), f"source {ref} leaked into trigger_config"
            assert str(ref) not in str(cloned_rule.conditions), f"source {ref} leaked into conditions"
            assert str(ref) not in str(cloned_rule.actions), f"source {ref} leaked into actions"

    @pytest.mark.django_db
    def test_duplicate_passes_through_state_group_and_user_id(
        self, system_api_client, automation_workspace, create_user
    ):
        """state_group is a string token, not a UUID — must pass through
        unchanged. add_assignee.user_id is workspace-scoped (members are
        cloned as the same users in the same workspace) — also untouched."""
        source = _make_project(automation_workspace, name="Pass Source", identifier="PSR")
        ProjectMember.objects.create(
            project=source, workspace=automation_workspace, member=create_user, role=20
        )
        AutomationRule.objects.create(
            project=source,
            workspace=automation_workspace,
            name="Group + user rule",
            trigger_type="state_changed",
            trigger_config={},
            conditions=[
                {"field": "state_group", "op": "eq", "value": "backlog"},
            ],
            actions=[
                {"type": "set_state", "config": {"state_group": "unstarted"}},
                {"type": "add_assignee", "config": {"user_id": str(create_user.id)}},
            ],
            is_active=True,
        )

        response = system_api_client.post(
            self._duplicate_url(automation_workspace.slug, source.id),
            data={"name": "Pass Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])
        cloned_rule = AutomationRule.objects.get(project=clone, name="Group + user rule")

        assert cloned_rule.conditions == [
            {"field": "state_group", "op": "eq", "value": "backlog"},
        ]
        assert cloned_rule.actions == [
            {"type": "set_state", "config": {"state_group": "unstarted"}},
            {"type": "add_assignee", "config": {"user_id": str(create_user.id)}},
        ]

    @pytest.mark.django_db
    def test_duplicate_resets_fire_counters(
        self, system_api_client, automation_workspace, create_user
    ):
        from django.utils import timezone

        source = _make_project(automation_workspace, name="Fired Source", identifier="FSR")
        ProjectMember.objects.create(
            project=source, workspace=automation_workspace, member=create_user, role=20
        )
        seed = DEFAULT_AUTOMATION_RULES[1]  # Notify on urgent
        AutomationRule.objects.create(
            project=source,
            workspace=automation_workspace,
            name=seed["name"],
            trigger_type=seed["trigger_type"],
            trigger_config=seed["trigger_config"],
            conditions=seed["conditions"],
            actions=seed["actions"],
            is_active=True,
            fire_count=42,
            last_fired_at=timezone.now(),
        )

        response = system_api_client.post(
            self._duplicate_url(automation_workspace.slug, source.id),
            data={"name": "Fresh Clone"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        clone = Project.objects.get(pk=response.json()["id"])

        cloned_rule = AutomationRule.objects.get(project=clone, name=seed["name"])
        assert cloned_rule.fire_count == 0, "clone must start with fresh fire counters"
        assert cloned_rule.last_fired_at is None
