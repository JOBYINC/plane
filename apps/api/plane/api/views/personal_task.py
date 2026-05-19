# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.api.serializers import IssueSerializer
from plane.api.views.base import BaseAPIView
from plane.app.permissions import IsSystemToken
from plane.app.services.personal_project import get_or_create_personal_project
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, User, Workspace, WorkspaceMember
from plane.utils.host import base_host


class PersonalTaskAPIEndpoint(BaseAPIView):
    """System-token endpoint that creates and updates work items in any
    workspace member's personal "My Tasks" project on behalf of that
    member.

    Reserved for tokens flagged ``is_service=True`` (see ``IsSystemToken``).
    Ordinary tokens are 403'd at the permission layer — they should use
    the regular per-project work-item endpoints.

    POST   /api/v1/workspaces/{slug}/personal-tasks/
    PATCH  /api/v1/workspaces/{slug}/personal-tasks/{work_item_id}/

    Idempotency follows the existing Issue contract: a duplicate
    ``(personal_project, external_source, external_id)`` returns 409 +
    the existing work item id.
    """

    model = Issue
    permission_classes = [IsSystemToken]
    serializer_class = IssueSerializer

    def _resolve_owner_in_workspace(self, slug, owner_id):
        """Return (workspace, owner) if owner is an active member of the
        workspace identified by slug, else raise the proper 4xx via
        Response-returning helpers in the caller.
        """
        try:
            workspace = Workspace.objects.get(slug=slug)
        except Workspace.DoesNotExist:
            return None, None, Response(
                {"error": "Workspace not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            owner = User.objects.get(pk=owner_id)
        except (User.DoesNotExist, ValueError):
            return None, None, Response(
                {"error": "Target owner user not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        is_member = WorkspaceMember.objects.filter(
            workspace=workspace, member=owner, is_active=True
        ).exists()
        if not is_member:
            return None, None, Response(
                {"error": "Target owner is not an active member of this workspace."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return workspace, owner, None

    def _set_on_behalf_of(self, request, target_uuid):
        """Persist the on-behalf-of UUID on the underlying Django
        ``HttpRequest`` so ``APITokenLogMiddleware`` (which runs at the
        Django layer, before DRF wraps the request) can include it in
        the audit log row. Setting on the DRF ``Request`` instance only
        would not reach the middleware.
        """
        underlying = getattr(request, "_request", request)
        underlying._acting_on_behalf_of = (
            str(target_uuid) if target_uuid is not None else None
        )

    def _build_response_body(self, slug, project, issue):
        """Build the success response payload per spec §4.1."""
        url = (
            f"{base_host(request=self.request, is_app=True).rstrip('/')}"
            f"/{slug}/projects/{project.id}/issues/{issue.id}"
        )
        return {
            "id": str(issue.id),
            "project_id": str(project.id),
            "project_identifier": project.identifier,
            "sequence_id": issue.sequence_id,
            "url": url,
        }

    def post(self, request, slug):
        """Create (or idempotently return) a work item in the owner's
        personal project.

        Request body MUST include ``owner`` (target user UUID),
        ``name``, ``external_source``, ``external_id``. Other Issue
        fields (priority, target_date, labels, description_html, …) are
        passed through to ``IssueSerializer`` unchanged.
        """
        owner_id = request.data.get("owner")
        if not owner_id:
            return Response(
                {"error": "`owner` (target user UUID) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        external_source = request.data.get("external_source")
        external_id = request.data.get("external_id")
        if not (external_source and external_id):
            return Response(
                {"error": "`external_source` and `external_id` are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Audit anchor: every API activity log row for this request gets
        # `acting_on_behalf_of=<owner_id>` so "system-on-behalf-of-X" is
        # queryable downstream. Set early so it persists even on 4xx.
        self._set_on_behalf_of(request, owner_id)

        workspace, owner, err = self._resolve_owner_in_workspace(slug, owner_id)
        if err is not None:
            return err

        project = get_or_create_personal_project(
            workspace=workspace, owner=owner, actor=request.user
        )

        # Idempotent reuse: matches the existing Issue create contract.
        existing = Issue.objects.filter(
            project_id=project.id,
            workspace=workspace,
            external_source=external_source,
            external_id=external_id,
        ).first()
        if existing is not None:
            return Response(
                {
                    "error": (
                        "Work item with the same external_id + external_source "
                        "already exists in this personal project."
                    ),
                    "id": str(existing.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Default assignees to [owner] so the work item shows up in the
        # owner's My Tasks view. Explicit assignees in body override.
        payload = dict(request.data)
        payload.pop("owner", None)
        payload.setdefault("assignees", [str(owner.id)])

        serializer = IssueSerializer(
            data=payload,
            context={
                "project_id": project.id,
                "workspace_id": workspace.id,
                "default_assignee_id": project.default_assignee_id,
            },
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        issue = Issue.objects.get(pk=serializer.data["id"])

        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(payload, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project.id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
        )

        return Response(
            self._build_response_body(slug, project, issue),
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request, slug, work_item_id):
        """Update a personal-project work item.

        Only the system token whose ``external_source`` originally
        created the work item may update it. PATCH without
        ``external_source`` in body, or with a mismatching source, is
        rejected 403 — this is the read/write-on-own-source privacy
        boundary spec §5 rule 2.
        """
        try:
            issue = Issue.objects.select_related("project", "workspace").get(
                pk=work_item_id,
                workspace__slug=slug,
                project__is_personal=True,
            )
        except Issue.DoesNotExist:
            return Response(
                {"error": "Personal-task work item not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Set audit anchor to the project owner — even on a 403, we want
        # the audit row to record which member's bucket was targeted.
        self._set_on_behalf_of(request, issue.project.personal_owner_id)

        body_source = request.data.get("external_source")
        if not body_source or issue.external_source != body_source:
            return Response(
                {
                    "error": (
                        "System tokens may only update work items they created. "
                        "Provide the original external_source in the body."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Strip identity-shaping fields the caller MUST NOT change here.
        payload = {
            k: v
            for k, v in request.data.items()
            if k not in {"owner", "project", "workspace"}
        }
        serializer = IssueSerializer(issue, data=payload, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        issue.refresh_from_db()

        return Response(
            self._build_response_body(slug, issue.project, issue),
            status=status.HTTP_200_OK,
        )
