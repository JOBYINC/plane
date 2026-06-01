# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Max
from django.db.utils import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseViewSet
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectSectionSerializer
from plane.db.models import ProjectSection

# Gap inserted between the largest existing sort_order and a freshly
# appended section. Float gap (not +1) so future reorders can keep
# slotting values between neighbours without a global renumber — the
# same float-between-neighbours trick used elsewhere in Plane.
SORT_ORDER_APPEND_GAP = 10000.0
SORT_ORDER_DEFAULT = 65535.0


class ProjectSectionViewSet(BaseViewSet):
    """CRUD over free-form `ProjectSection`s scoped to a single project.

    URL: /api/v1/workspaces/<slug>/projects/<uuid:project_id>/sections/

    Sections are a PURELY organizational axis — this viewset never reads
    or writes State (`group`). See docs/sections-design.md §2 (hard
    constraint) and §5 (REST contract). DELETE archives (soft) and leaves
    every issue's `section_id` intact: deleting a bucket must never delete
    or reclassify work.

    Permissions (§5): project ADMIN/MEMBER may CRUD sections; GUEST may
    read so a board grouped by section still renders for them.
    """

    serializer_class = ProjectSectionSerializer
    model = ProjectSection

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project", "workspace")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        sections = (
            self.get_queryset().filter(is_archived=False).order_by("sort_order")
        )
        return Response(
            ProjectSectionSerializer(sections, many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        section = self.get_queryset().filter(pk=pk).first()
        if not section:
            return Response(
                {"error": "Section not found"}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(
            ProjectSectionSerializer(section).data, status=status.HTTP_200_OK
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        serializer = ProjectSectionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Auto-append: place a new section after the current last one
        # unless the client explicitly pinned a sort_order (drag-create).
        sort_order = serializer.validated_data.get("sort_order")
        if sort_order is None:
            largest = ProjectSection.objects.filter(project_id=project_id).aggregate(
                largest=Max("sort_order")
            )["largest"]
            sort_order = (
                largest + SORT_ORDER_APPEND_GAP
                if largest is not None
                else SORT_ORDER_DEFAULT
            )

        try:
            serializer.save(project_id=project_id, sort_order=sort_order)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "A section with this name already exists"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raise
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, pk):
        section = self.get_queryset().filter(pk=pk).first()
        if not section:
            return Response(
                {"error": "Section not found"}, status=status.HTTP_404_NOT_FOUND
            )
        serializer = ProjectSectionSerializer(
            section, data=request.data, partial=True
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            serializer.save()
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "A section with this name already exists"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raise
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, pk):
        """Soft-archive, NOT delete (§5).

        Issues keep their `section_id` — they just fall back to the
        "(No section)" bucket in pickers/grouping until the section is
        un-archived. Work is never destroyed by removing a container.
        """
        section = self.get_queryset().filter(pk=pk).first()
        if not section:
            return Response(
                {"error": "Section not found"}, status=status.HTTP_404_NOT_FOUND
            )
        section.is_archived = True
        section.save(update_fields=["is_archived", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
