# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Issue, ProjectSection


class IssueSectionEndpoint(BaseAPIView):
    """Set or clear an issue's free-form Section.

    PUT /api/v1/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/section/
    Body: ``{"section_id": "<uuid>"}`` to assign, ``{"section_id": null}``
    to clear (fall back to the "(No section)" bucket).

    Deliberately NOT routed through the generic issue PATCH / IssueActivity
    / automation pipeline. A Section move is a pure organizational
    reorganization with zero workflow meaning: it never reads or writes
    State, and the write is a scoped ``.update()`` so ``Issue.save()``'s
    state-default / completion logic is not even invoked. This keeps the
    Sections axis fully decoupled from State — docs/sections-design.md
    §2 (hard constraint) and §5 (REST contract).

    Permission (§5): project ADMIN/MEMBER may move issues between sections.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def put(self, request, slug, project_id, issue_id):
        issue = Issue.objects.filter(
            pk=issue_id, project_id=project_id, workspace__slug=slug
        ).first()
        if issue is None:
            return Response(
                {"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # `section_id` must be explicitly present. Its value may be null
        # (clear the section) or a uuid (assign). Absent != null, so we
        # don't silently no-op a malformed body.
        if "section_id" not in request.data:
            return Response(
                {"error": "section_id is required (pass null to clear)"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        section_id = request.data.get("section_id")

        if section_id is not None:
            try:
                uuid.UUID(str(section_id))
            except (ValueError, AttributeError, TypeError):
                return Response(
                    {"error": "section_id is not a valid uuid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Section must belong to THIS project. Validated against
            # ProjectSection only — never against State (§2).
            if not ProjectSection.objects.filter(
                pk=section_id, project_id=project_id
            ).exists():
                return Response(
                    {"error": "Section is not valid please pass a valid section_id"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Scoped single-column update: no Issue.save() override, no
        # signals, no state/completion recompute. Pure reorganization.
        Issue.objects.filter(pk=issue_id).update(
            section_id=section_id, updated_at=timezone.now()
        )
        return Response({"section_id": section_id}, status=status.HTTP_200_OK)
