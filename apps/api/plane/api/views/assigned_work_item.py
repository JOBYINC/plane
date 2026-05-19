# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from plane.api.serializers import IssueSerializer
from plane.api.views.base import BaseAPIView
from plane.app.permissions import IsSystemToken
from plane.db.models import Issue


class AssignedWorkItemAPIEndpoint(BaseAPIView):
    """System-token read endpoint that returns the target user's
    assigned work items across the entire workspace — both their
    personal "My Tasks" project AND any shared project they're a
    member of.

    Reserved for tokens flagged ``is_service=True`` (see
    ``IsSystemToken``). Privacy boundary: only items where the target
    is an assignee are returned. Items in shared projects the target
    is not assigned on, or in someone else's personal project, are
    not visible.

    GET /api/v1/workspaces/{slug}/assigned-work-items/?assignee=<uuid>
        &state_group=backlog,unstarted,started     # optional CSV filter
        &target_date_before=2026-05-20T01:00:00Z   # optional ISO date(time)

    Pagination envelope matches the existing token-API list pattern
    (cursor + per_page).
    """

    model = Issue
    permission_classes = [IsSystemToken]
    serializer_class = IssueSerializer
    use_read_replica = True

    def _set_on_behalf_of(self, request, target_uuid):
        """Persist on the underlying Django ``HttpRequest`` so
        ``APITokenLogMiddleware`` can include it in the audit row.
        Mirrors the helper on ``PersonalTaskAPIEndpoint``.
        """
        underlying = getattr(request, "_request", request)
        underlying._acting_on_behalf_of = (
            str(target_uuid) if target_uuid is not None else None
        )

    @extend_schema(
        operation_id="list_assigned_work_items",
        summary="List a workspace member's assigned work items",
        description=(
            "System-token endpoint. Returns the target user's assigned "
            "work items across the entire workspace — both their personal "
            "'My Tasks' project AND any shared project they're a member "
            "of. Privacy boundary: only items where the target is an "
            "assignee are returned. Optional filters: state_group (CSV) "
            "and target_date_before (ISO date). Requires an APIToken "
            "flagged is_service=True."
        ),
        tags=["Assigned Work Items"],
    )
    def get(self, request, slug):
        assignee = request.query_params.get("assignee")
        if not assignee:
            return Response(
                {
                    "error": (
                        "`assignee` query parameter (target user UUID) is required."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            assignee_uuid = uuid.UUID(str(assignee))
        except (ValueError, TypeError):
            return Response(
                {"error": "`assignee` must be a valid UUID."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Audit anchor before any further work so even a 4xx on filter
        # parsing carries the on-behalf-of attribution.
        self._set_on_behalf_of(request, assignee_uuid)

        # Cross-project, workspace-scoped, assignee-filtered. NO
        # is_personal exclusion — that exclusion only lives on the
        # session API (project.base ProjectViewSet.list / list_detail);
        # the token API queryset on Issue is naturally cross-project,
        # which is what spec §6 Q1 (a-extended) requires.
        queryset = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                assignees__id=assignee_uuid,
            )
            .select_related("project", "workspace", "state", "parent")
            .prefetch_related("assignees", "labels")
            .distinct()
        )

        state_group = request.query_params.get("state_group")
        if state_group:
            groups = [g.strip() for g in state_group.split(",") if g.strip()]
            if groups:
                queryset = queryset.filter(state__group__in=groups)

        target_date_before = request.query_params.get("target_date_before")
        if target_date_before:
            queryset = queryset.filter(target_date__lt=target_date_before)

        queryset = queryset.order_by("-created_at")

        return self.paginate(
            request=request,
            queryset=queryset,
            on_results=lambda issues: IssueSerializer(
                issues, many=True, fields=self.fields, expand=self.expand
            ).data,
        )
