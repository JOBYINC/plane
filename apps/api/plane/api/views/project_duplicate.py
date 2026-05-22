# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Server-side deep-clone of a Project and all of its child entities.

POST /api/v1/workspaces/<slug>/projects/<project_id>/duplicate/

Mirrors the URL shape and ORM-clone pattern of ``PageDuplicateEndpoint``
(``apps/api/plane/app/views/page/base.py``). The goal is to retire the
client-side "fork" loop that issued ~750 HTTP calls per launch and hit
four distinct silent-drop bugs in two weeks — see the feature spec at
``agents/_inbox/plane-project-clone-feature-request.md``.

Implementation outline (§8 of the spec):

  states → labels → cycles → modules → fields(+options) → members
  → issues (parents first, then subtasks so parent_id can be remapped)
  → side-tables: assignees / labels / module attach / cycle attach
    / field values / blocked_by relations

Everything runs inside a single ``transaction.atomic()`` — partial
failure rolls back the whole project (the §5 "no orphan project" rule
that the client-side workaround can't guarantee).
"""

from datetime import date, timedelta
from typing import Dict, Optional, Tuple
from uuid import UUID

from django.db import transaction
from django.db.models import Min
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.app.permissions import ProjectBasePermission
from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import (
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
    WorkItemField,
    WorkItemFieldOption,
    WorkItemFieldValue,
)

from .base import BaseAPIView


# Imported here so contract tests can blanket-mock celery .delay() entry
# points even though we don't enqueue activity here ourselves; downstream
# model save() hooks may queue work indirectly.
try:
    from plane.bgtasks.issue_activities_task import issue_activity  # noqa: F401
except Exception:  # pragma: no cover - defensive
    issue_activity = None  # type: ignore[assignment]

try:
    from plane.bgtasks.webhook_task import model_activity  # noqa: F401
except Exception:  # pragma: no cover - defensive
    model_activity = None  # type: ignore[assignment]


# A UUID-to-UUID remap from a source-project row to its clone.
RemapDict = Dict[UUID, UUID]


def _coerce_int(value, default=0) -> int:
    """Body fields like ``rebump_target_dates_by_days`` are int but may
    arrive as strings via JSON-coerce or be missing entirely. Tolerate
    both shapes; reject anything non-integer-castable (clients should
    fail loudly, not have a typo silently apply 0)."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"expected integer, got {value!r}") from exc


class ProjectDuplicateEndpoint(BaseAPIView):
    # Used from BOTH the token API (GTM agents with X-Api-Key) and the web
    # UI (the "Save as template" quick action + the create-from-template
    # modal). BaseAPIView is token-only, so also accept the app's session
    # auth — without it the session-authenticated web gets a 401.
    # BaseSessionAuthentication (not DRF's stock SessionAuthentication) is
    # what every /api/ app endpoint uses; it skips CSRF the same way, so
    # the web's session POST works. Token callers are unaffected
    # (APIKeyAuthentication still runs first).
    authentication_classes = [APIKeyAuthentication, BaseSessionAuthentication]
    permission_classes = [ProjectBasePermission]
    webhook_event = "project"

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    @extend_schema(
        operation_id="duplicate_project",
        summary="Deep-clone a project including cycles, modules, issues, custom fields, and blocked_by relations",
        tags=["Projects"],
    )
    def post(self, request, slug, project_id):
        source = (
            Project.objects.filter(workspace__slug=slug, pk=project_id)
            .select_related("workspace")
            .first()
        )
        if source is None:
            return Response(
                {"error": "Project not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        body = request.data or {}
        try:
            date_delta = timedelta(days=_coerce_int(body.get("rebump_target_dates_by_days")))
            cycle_delta = timedelta(days=_coerce_int(body.get("rebump_cycle_windows_by_days")))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # anchor_start_date re-anchors the whole timeline: the source's
        # earliest date is moved onto anchor_start_date and every other date
        # shifts by the same delta, so relative gaps (the project's overall
        # span) are preserved. One delta drives BOTH issues and cycles. It
        # overrides the rebump_* deltas when given; agents that still pass
        # rebump_* keep working unchanged.
        anchor_raw = body.get("anchor_start_date")
        if anchor_raw:
            try:
                anchor = date.fromisoformat(str(anchor_raw))
            except ValueError:
                return Response(
                    {"error": "`anchor_start_date` must be an ISO date (YYYY-MM-DD)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            earliest = self._earliest_timeline_date(source)
            if earliest is not None:
                date_delta = cycle_delta = timedelta(days=(anchor - earliest).days)

        override_field_values = body.get("override_custom_field_values") or {}
        if not isinstance(override_field_values, dict):
            return Response(
                {"error": "`override_custom_field_values` must be an object."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            clone = self._clone_project_record(source, body, request.user)

            # External-id prefix remap (§3 last row). If the caller gave the
            # clone a new external_id, child rows whose external_id starts
            # with the SOURCE project's external_id prefix get that prefix
            # rewritten. If no new external_id, child external_ids are
            # nulled (the safe default — avoids unique-constraint collisions
            # on re-clone, matches §3 fallback).
            external_id_remap = self._make_external_id_remap(source, clone)

            state_map = self._clone_states(source, clone, request.user, external_id_remap)
            label_map = self._clone_labels(source, clone, request.user, external_id_remap)
            cycle_map = self._clone_cycles(
                source, clone, cycle_delta, request.user, external_id_remap
            )
            module_map = self._clone_modules(source, clone, request.user, external_id_remap)
            field_map, option_map = self._clone_custom_fields(
                source, clone, request.user, external_id_remap
            )
            self._clone_project_members(source, clone, request.user)

            issue_map = self._clone_issues(
                source=source,
                clone=clone,
                date_delta=date_delta,
                state_map=state_map,
                actor=request.user,
                external_id_remap=external_id_remap,
            )

            self._clone_issue_assignees(source, issue_map, clone, request.user)
            self._clone_issue_labels(source, issue_map, label_map, clone, request.user)
            self._clone_module_issues(source, issue_map, module_map, clone, request.user)
            self._clone_cycle_issues(source, issue_map, cycle_map, clone, request.user)
            self._clone_field_values(
                source=source,
                clone=clone,
                issue_map=issue_map,
                field_map=field_map,
                option_map=option_map,
                override_field_values=override_field_values,
                actor=request.user,
            )
            self._clone_issue_relations(source, issue_map, clone, request.user)

        return Response(self._serialize(clone), status=status.HTTP_201_CREATED)

    def _earliest_timeline_date(self, source: Project) -> Optional[date]:
        """Earliest date anywhere in the source project's timeline — across
        issue start/target dates and cycle start/end dates. Used to
        re-anchor a clone via ``anchor_start_date``. Returns None when the
        project has no dated rows; datetimes are normalised to dates."""
        issue_dates = Issue.objects.filter(project=source).aggregate(
            s=Min("start_date"), t=Min("target_date")
        )
        cycle_dates = Cycle.objects.filter(project=source).aggregate(
            s=Min("start_date"), e=Min("end_date")
        )
        candidates = [
            v.date() if hasattr(v, "date") else v
            for v in (
                issue_dates["s"],
                issue_dates["t"],
                cycle_dates["s"],
                cycle_dates["e"],
            )
            if v is not None
        ]
        return min(candidates) if candidates else None

    # ------------------------------------------------------------------
    # Per-entity cloners. Each follows the ``obj.pk = None`` pattern from
    # PageDuplicateEndpoint, remaps the project FK, then ``save()``.
    # Keeping them small + named is what lets the spec's per-row per-field
    # acceptance bar be read directly off the code.
    # ------------------------------------------------------------------

    def _clone_project_record(self, source: Project, body: dict, actor) -> Project:
        clone = Project.objects.get(pk=source.pk)
        clone.pk = None
        clone.name = body.get("name") or f"{source.name} (Copy)"
        # identifier uniqueness is enforced at the DB level via a partial
        # unique constraint; if the caller passes one we use it, else we
        # synthesize a unique short prefix from the source's identifier.
        clone.identifier = (body.get("identifier") or self._unique_identifier(source)).upper()
        # external_source is carried over by default (matches "this is the
        # same lineage" semantics); external_id MUST NOT be carried or the
        # workspace-wide unique constraint trips on re-clone (§3).
        if "external_source" in body:
            clone.external_source = body["external_source"]
        clone.external_id = body.get("external_id")
        # Default: a clone is a normal launch project, not another template,
        # so duplicating a template doesn't multiply the templates group.
        # Callers can opt the clone into being a template by passing
        # ``is_template: true`` — this is how "Save as template" duplicates a
        # normal project into the workspace template library.
        clone.is_template = bool(body.get("is_template", False))
        clone.created_by = actor
        clone.updated_by = actor
        clone.archived_at = None
        clone.save()
        return clone

    def _make_external_id_remap(self, source: Project, clone: Project):
        """Build the function that turns a child row's source external_id
        into the clone-appropriate value. Three regimes:

        1. New external_id given AND source had one → rewrite the leading
           ``<source_prefix>:`` segment to ``<clone_prefix>:``. The prefix
           is everything up to and including the first ``:`` (e.g.,
           ``GPBV:cycle:Prep`` → ``GP02:cycle:Prep``).
        2. New external_id given but source had none → leave child
           external_ids untouched as-is is unsafe (workspace-wide uniqueness
           pressure on re-clone). We return None so children get null.
        3. New external_id null → null all child external_ids.

        The remap is intentionally a single closure to keep clone helpers
        from each re-implementing the prefix logic.
        """
        new_id = clone.external_id
        old_id = source.external_id

        if not new_id:
            return lambda _value: None

        if not old_id:
            # Source had no external_id; can't infer a prefix. Null
            # children to stay safe (matches case 2 in docstring).
            return lambda _value: None

        old_prefix = old_id.split(":", 1)[0] + ":"
        new_prefix = new_id.split(":", 1)[0] + ":"

        def _remap(value):
            if not value:
                return None
            if value.startswith(old_prefix):
                return new_prefix + value[len(old_prefix):]
            # Child has an external_id from a different namespace than the
            # source project — safer to null than to claim it under the new
            # prefix.
            return None

        return _remap

    def _unique_identifier(self, source: Project) -> str:
        """Find a workspace-unique identifier built from the source's
        identifier. Mirrors Plane's own per-workspace identifier uniqueness
        guarantee without invoking the create-time identifier picker (which
        lives behind the public Project create endpoint)."""
        base = (source.identifier or "TPL")[:6]
        for suffix in range(1, 10000):
            candidate = f"{base}{suffix}"[:12]
            if not Project.objects.filter(
                workspace_id=source.workspace_id, identifier=candidate
            ).exists():
                return candidate
        raise ValueError("Exhausted identifier suffix space")

    def _clone_states(
        self, source: Project, clone: Project, actor, external_id_remap
    ) -> RemapDict:
        # State has no external_id usage in the spec's prefix-remap row,
        # but the field exists on the model and is workspace-scoped to
        # the same uniqueness pressure as other entities. Apply the
        # remap so a re-clone never collides on (source, external_id).
        remap: RemapDict = {}
        for state in State.all_state_objects.filter(
            project=source, deleted_at__isnull=True
        ).order_by("sequence"):
            original_id = state.id
            state.pk = None
            state.project = clone
            state.workspace = clone.workspace
            state.external_id = external_id_remap(state.external_id)
            state.created_by = actor
            state.updated_by = actor
            state.save()
            remap[original_id] = state.id
        return remap

    def _clone_labels(
        self, source: Project, clone: Project, actor, external_id_remap
    ) -> RemapDict:
        remap: RemapDict = {}
        for label in Label.objects.filter(project=source).order_by("sort_order"):
            original_id = label.id
            label.pk = None
            label.project = clone
            label.workspace = clone.workspace
            label.external_id = external_id_remap(label.external_id)
            label.created_by = actor
            label.updated_by = actor
            label.save()
            remap[original_id] = label.id
        return remap

    def _clone_cycles(
        self,
        source: Project,
        clone: Project,
        cycle_delta: timedelta,
        actor,
        external_id_remap,
    ) -> RemapDict:
        remap: RemapDict = {}
        for cycle in Cycle.objects.filter(project=source).order_by("sort_order"):
            original_id = cycle.id
            cycle.pk = None
            cycle.project = clone
            cycle.workspace = clone.workspace
            cycle.external_id = external_id_remap(cycle.external_id)
            if cycle.start_date and cycle_delta:
                cycle.start_date = cycle.start_date + cycle_delta
            if cycle.end_date and cycle_delta:
                cycle.end_date = cycle.end_date + cycle_delta
            cycle.created_by = actor
            cycle.updated_by = actor
            cycle.save()
            remap[original_id] = cycle.id
        return remap

    def _clone_modules(
        self, source: Project, clone: Project, actor, external_id_remap
    ) -> RemapDict:
        remap: RemapDict = {}
        for module in Module.objects.filter(project=source).order_by("sort_order"):
            original_id = module.id
            source_member_ids = list(
                ModuleMember.objects.filter(module_id=original_id).values_list(
                    "member_id", flat=True
                )
            )
            module.pk = None
            module.project = clone
            module.workspace = clone.workspace
            module.external_id = external_id_remap(module.external_id)
            module.created_by = actor
            module.updated_by = actor
            module.save()
            remap[original_id] = module.id
            for member_id in source_member_ids:
                ModuleMember.objects.create(
                    module=module,
                    member_id=member_id,
                    project=clone,
                    workspace=clone.workspace,
                    created_by=actor,
                    updated_by=actor,
                )
        return remap

    def _clone_custom_fields(
        self, source: Project, clone: Project, actor, external_id_remap
    ) -> Tuple[RemapDict, RemapDict]:
        field_map: RemapDict = {}
        option_map: RemapDict = {}
        for field in WorkItemField.objects.filter(project=source).order_by("sort_order"):
            original_field_id = field.id
            field.pk = None
            field.project = clone
            field.workspace = clone.workspace
            field.external_id = external_id_remap(field.external_id)
            field.created_by = actor
            field.updated_by = actor
            field.save()
            field_map[original_field_id] = field.id

            for option in WorkItemFieldOption.objects.filter(
                field_id=original_field_id
            ).order_by("sort_order"):
                original_option_id = option.id
                option.pk = None
                option.field = field
                option.project = clone
                option.workspace = clone.workspace
                option.external_id = external_id_remap(option.external_id)
                option.created_by = actor
                option.updated_by = actor
                option.save()
                option_map[original_option_id] = option.id
        return field_map, option_map

    def _clone_project_members(self, source: Project, clone: Project, actor) -> None:
        for member in ProjectMember.objects.filter(project=source):
            ProjectMember.objects.create(
                project=clone,
                workspace=clone.workspace,
                member_id=member.member_id,
                role=member.role,
                comment=member.comment,
                view_props=member.view_props,
                default_props=member.default_props,
                preferences=member.preferences,
                is_active=member.is_active,
                created_by=actor,
                updated_by=actor,
            )

    def _clone_issues(
        self,
        source: Project,
        clone: Project,
        date_delta: timedelta,
        state_map: RemapDict,
        actor,
        external_id_remap,
    ) -> RemapDict:
        """Two-pass walk: parents first so subtasks can resolve parent_id
        through ``issue_map``. ``order_by("created_at")`` keeps the clone
        sequence_id assignment in source-order, which is what users see
        in the URL (``MT92-1`` is the first-created issue, etc.).
        """
        issue_map: RemapDict = {}

        def _clone_one(src_issue: Issue, parent_id):
            original_id = src_issue.id
            src_issue.pk = None
            src_issue.project = clone
            src_issue.workspace = clone.workspace
            src_issue.state_id = state_map.get(src_issue.state_id) if src_issue.state_id else None
            src_issue.parent_id = parent_id
            src_issue.external_id = external_id_remap(src_issue.external_id)
            if src_issue.target_date and date_delta:
                src_issue.target_date = src_issue.target_date + date_delta
            if src_issue.start_date and date_delta:
                src_issue.start_date = src_issue.start_date + date_delta
            src_issue.created_by = actor
            src_issue.updated_by = actor
            src_issue.save()
            issue_map[original_id] = src_issue.id

        # Pass 1: parents. Refetch each row instead of holding a single
        # queryset in memory across saves — Issue.save() reads the issue
        # table itself (sequence_id / sort_order computation) and a stale
        # iterator can hand back the just-saved clone.
        for parent_id in list(
            Issue.issue_objects.filter(project=source, parent__isnull=True)
            .order_by("created_at")
            .values_list("id", flat=True)
        ):
            _clone_one(Issue.objects.get(pk=parent_id), parent_id=None)

        # Pass 2: subtasks.
        for sub_id, source_parent_id in list(
            Issue.issue_objects.filter(project=source, parent__isnull=False)
            .order_by("created_at")
            .values_list("id", "parent_id")
        ):
            _clone_one(
                Issue.objects.get(pk=sub_id),
                parent_id=issue_map.get(source_parent_id),
            )
        return issue_map

    def _clone_issue_assignees(
        self,
        source: Project,
        issue_map: RemapDict,
        clone: Project,
        actor,
    ) -> None:
        for assignee in IssueAssignee.objects.filter(project=source):
            cloned_issue_id = issue_map.get(assignee.issue_id)
            if not cloned_issue_id:
                continue
            IssueAssignee.objects.create(
                issue_id=cloned_issue_id,
                assignee_id=assignee.assignee_id,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
            )

    def _clone_issue_labels(
        self,
        source: Project,
        issue_map: RemapDict,
        label_map: RemapDict,
        clone: Project,
        actor,
    ) -> None:
        for il in IssueLabel.objects.filter(project=source):
            cloned_issue_id = issue_map.get(il.issue_id)
            cloned_label_id = label_map.get(il.label_id)
            if not cloned_issue_id or not cloned_label_id:
                continue
            IssueLabel.objects.create(
                issue_id=cloned_issue_id,
                label_id=cloned_label_id,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
            )

    def _clone_module_issues(
        self,
        source: Project,
        issue_map: RemapDict,
        module_map: RemapDict,
        clone: Project,
        actor,
    ) -> None:
        for mi in ModuleIssue.objects.filter(project=source):
            cloned_issue_id = issue_map.get(mi.issue_id)
            cloned_module_id = module_map.get(mi.module_id)
            if not cloned_issue_id or not cloned_module_id:
                continue
            ModuleIssue.objects.create(
                issue_id=cloned_issue_id,
                module_id=cloned_module_id,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
            )

    def _clone_cycle_issues(
        self,
        source: Project,
        issue_map: RemapDict,
        cycle_map: RemapDict,
        clone: Project,
        actor,
    ) -> None:
        for ci in CycleIssue.objects.filter(project=source):
            cloned_issue_id = issue_map.get(ci.issue_id)
            cloned_cycle_id = cycle_map.get(ci.cycle_id)
            if not cloned_issue_id or not cloned_cycle_id:
                continue
            CycleIssue.objects.create(
                issue_id=cloned_issue_id,
                cycle_id=cloned_cycle_id,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
            )

    def _clone_field_values(
        self,
        source: Project,
        clone: Project,
        issue_map: RemapDict,
        field_map: RemapDict,
        option_map: RemapDict,
        override_field_values: dict,
        actor,
    ) -> None:
        """Per-issue custom field values. ``value_text`` for single_select
        holds the option UUID as a string, so it MUST be remapped through
        ``option_map``; ``value_multi`` for multi_select holds an array of
        option UUIDs (same remap); ``value_multi`` for ``people`` holds
        user UUIDs and is carried as-is (same workspace members).

        ``override_field_values`` lets the caller force a specific value
        on every issue at clone-time, addressed by field NAME (so the
        caller doesn't need to know the new field UUID). For single_select
        the override value is the OPTION NAME, looked up against the
        clone's options. Spec §6 — primary use case is setting ``Tier``
        per-launch without a post-clone PATCH loop.
        """
        # Pre-resolve overrides into (clone_field_id → resolved_value)
        # so we don't re-do this work per WorkItemFieldValue row.
        clone_fields_by_name = {
            f.name: f for f in WorkItemField.objects.filter(project=clone)
        }
        resolved_overrides: Dict[UUID, dict] = {}
        for field_name, raw_value in override_field_values.items():
            target_field = clone_fields_by_name.get(field_name)
            if target_field is None:
                continue
            resolved_overrides[target_field.id] = self._resolve_override_value(
                target_field, raw_value
            )

        for fv in WorkItemFieldValue.objects.filter(project=source):
            cloned_issue_id = issue_map.get(fv.issue_id)
            cloned_field_id = field_map.get(fv.field_id)
            if not cloned_issue_id or not cloned_field_id:
                continue

            # If the caller asked us to override this field, use that and
            # skip the source's value remap entirely.
            override = resolved_overrides.get(cloned_field_id)
            if override is not None:
                WorkItemFieldValue.objects.create(
                    issue_id=cloned_issue_id,
                    field_id=cloned_field_id,
                    project=clone,
                    workspace=clone.workspace,
                    created_by=actor,
                    updated_by=actor,
                    **override,
                )
                continue

            kwargs = self._remap_field_value_columns(
                fv,
                clone_field_id=cloned_field_id,
                option_map=option_map,
            )
            WorkItemFieldValue.objects.create(
                issue_id=cloned_issue_id,
                field_id=cloned_field_id,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
                **kwargs,
            )

        # Override may also need to LAND on issues that had no source
        # value for the field. Walk every cloned issue and write the
        # override where one doesn't already exist for that (issue, field).
        for clone_field_id, override in resolved_overrides.items():
            existing_issue_ids = set(
                WorkItemFieldValue.objects.filter(
                    project=clone, field_id=clone_field_id
                ).values_list("issue_id", flat=True)
            )
            for cloned_issue_id in issue_map.values():
                if cloned_issue_id in existing_issue_ids:
                    continue
                WorkItemFieldValue.objects.create(
                    issue_id=cloned_issue_id,
                    field_id=clone_field_id,
                    project=clone,
                    workspace=clone.workspace,
                    created_by=actor,
                    updated_by=actor,
                    **override,
                )

    @staticmethod
    def _remap_field_value_columns(
        fv: WorkItemFieldValue,
        *,
        clone_field_id: UUID,
        option_map: RemapDict,
    ) -> dict:
        """Convert a source WorkItemFieldValue row into kwargs for the
        clone row, applying the option-UUID remap where applicable."""
        kwargs = {
            "value_text": fv.value_text,
            "value_number": fv.value_number,
            "value_date": fv.value_date,
            "value_multi": fv.value_multi,
        }
        # single_select: value_text holds an option UUID as a string.
        if fv.value_text:
            try:
                src_opt_uuid = UUID(fv.value_text)
            except (TypeError, ValueError):
                src_opt_uuid = None
            if src_opt_uuid and src_opt_uuid in option_map:
                kwargs["value_text"] = str(option_map[src_opt_uuid])

        # multi_select OR people: value_multi is an array of UUIDs as
        # strings. Remap option UUIDs through option_map; user UUIDs
        # (people field) won't appear in option_map and pass through.
        if fv.value_multi:
            kwargs["value_multi"] = [
                str(option_map[UUID(v)]) if _is_uuid(v) and UUID(v) in option_map else v
                for v in fv.value_multi
            ]
        return kwargs

    def _resolve_override_value(
        self, field: WorkItemField, raw_value
    ) -> dict:
        """Translate the user-facing override (e.g. ``"S"`` for Tier) into
        the same value_text / value_number / value_multi shape the model
        layer expects. Field type drives the column choice."""
        ft = field.field_type
        if ft == WorkItemField.FieldType.SINGLE_SELECT:
            # raw_value is the option NAME on the clone — look it up.
            opt = WorkItemFieldOption.objects.filter(
                field=field, name=str(raw_value)
            ).first()
            return {
                "value_text": str(opt.id) if opt else None,
                "value_number": None,
                "value_date": None,
                "value_multi": None,
            }
        if ft == WorkItemField.FieldType.MULTI_SELECT:
            values = raw_value if isinstance(raw_value, list) else [raw_value]
            resolved = []
            for v in values:
                opt = WorkItemFieldOption.objects.filter(
                    field=field, name=str(v)
                ).first()
                if opt:
                    resolved.append(str(opt.id))
            return {
                "value_text": None,
                "value_number": None,
                "value_date": None,
                "value_multi": resolved or None,
            }
        if ft == WorkItemField.FieldType.NUMBER:
            return {
                "value_text": None,
                "value_number": raw_value,
                "value_date": None,
                "value_multi": None,
            }
        if ft == WorkItemField.FieldType.DATE:
            return {
                "value_text": None,
                "value_number": None,
                "value_date": raw_value,
                "value_multi": None,
            }
        # text / people (people overrides not supported in v1 — would
        # need workspace member id lookup; falls into text bucket).
        return {
            "value_text": str(raw_value) if raw_value is not None else None,
            "value_number": None,
            "value_date": None,
            "value_multi": None,
        }

    def _clone_issue_relations(
        self,
        source: Project,
        issue_map: RemapDict,
        clone: Project,
        actor,
    ) -> None:
        for rel in IssueRelation.objects.filter(project=source):
            cloned_issue_id = issue_map.get(rel.issue_id)
            cloned_related_id = issue_map.get(rel.related_issue_id)
            if not cloned_issue_id or not cloned_related_id:
                continue
            IssueRelation.objects.create(
                issue_id=cloned_issue_id,
                related_issue_id=cloned_related_id,
                relation_type=rel.relation_type,
                project=clone,
                workspace=clone.workspace,
                created_by=actor,
                updated_by=actor,
            )

    # ------------------------------------------------------------------
    # Response shaping
    # ------------------------------------------------------------------

    def _serialize(self, clone: Project) -> dict:
        """Minimal envelope: callers need the new id + identifier to
        bookmark the clone; the rest comes from a follow-up GET. Returning
        the lighter shape avoids re-loading every annotation that the
        full ProjectSerializer adds."""
        return {
            "id": str(clone.id),
            "name": clone.name,
            "identifier": clone.identifier,
            "workspace_id": str(clone.workspace_id),
            "external_source": clone.external_source,
            "external_id": clone.external_id,
            "is_template": clone.is_template,
        }


def _is_uuid(v) -> bool:
    if not isinstance(v, str):
        return False
    try:
        UUID(v)
        return True
    except (TypeError, ValueError):
        return False
