# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import IntegrityError

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    WorkItemFieldOptionSerializer,
    WorkItemFieldSerializer,
    WorkItemFieldValueSerializer,
)
from plane.app.serializers.work_item_field import (
    assign_field_value,
    serialize_field_value,
)
from plane.db.models import WorkItemField, WorkItemFieldOption, WorkItemFieldValue
from .. import BaseAPIView, BaseViewSet


class WorkItemFieldViewSet(BaseViewSet):
    """CRUD over custom field schemas scoped to a single project.

    URL: /api/v1/workspaces/<slug>/projects/<uuid:project_id>/fields/
    Permission (design §5): project ADMIN+MEMBER read; ADMIN writes the
    schema. DELETE is an archive (is_active=False), not a hard delete --
    values stay and the name stays reserved while archived.
    """

    serializer_class = WorkItemFieldSerializer
    model = WorkItemField

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
            .prefetch_related("options")
            .select_related("project", "workspace")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id):
        fields = self.get_queryset().order_by("sort_order")
        return Response(WorkItemFieldSerializer(fields, many=True).data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def retrieve(self, request, slug, project_id, pk):
        field = self.get_queryset().filter(pk=pk).first()
        if not field:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(WorkItemFieldSerializer(field).data)

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        try:
            serializer = WorkItemFieldSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save(project_id=project_id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, slug, project_id, pk):
        field = self.get_queryset().filter(pk=pk).first()
        if not field:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            serializer = WorkItemFieldSerializer(
                field, data=request.data, partial=True
            )
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save()
            return Response(serializer.data)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        # Archive (design §5: DELETE soft-deletes via is_active=False).
        field = self.get_queryset().filter(pk=pk).first()
        if not field:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        field.is_active = False
        field.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemFieldOptionViewSet(BaseViewSet):
    """CRUD over a single field's selectable options.

    URL: .../projects/<uuid:project_id>/fields/<uuid:field_id>/options/
    Same permission model as the parent field schema.
    """

    serializer_class = WorkItemFieldOptionSerializer
    model = WorkItemFieldOption

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(field_id=self.kwargs.get("field_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("field", "project", "workspace")
            .distinct()
        )

    def _field_or_none(self, slug, project_id, field_id):
        return (
            WorkItemField.objects.filter(
                pk=field_id,
                project_id=project_id,
                workspace__slug=slug,
            )
            .first()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id, field_id):
        options = self.get_queryset().order_by("sort_order")
        return Response(WorkItemFieldOptionSerializer(options, many=True).data)

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id, field_id):
        if not self._field_or_none(slug, project_id, field_id):
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        try:
            serializer = WorkItemFieldOptionSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save(project_id=project_id, field_id=field_id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists on the field"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, slug, project_id, field_id, pk):
        option = self.get_queryset().filter(pk=pk).first()
        if not option:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            serializer = WorkItemFieldOptionSerializer(
                option, data=request.data, partial=True
            )
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save()
            return Response(serializer.data)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists on the field"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, field_id, pk):
        # Archive (design §5: DELETE soft-deletes the option via is_active).
        option = self.get_queryset().filter(pk=pk).first()
        if not option:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        option.is_active = False
        option.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemFieldValueViewSet(BaseViewSet):
    """Per-issue custom field values.

    URLs (design §5):
      GET    issues/<issue_id>/field-values/              -> all values
      PUT    issues/<issue_id>/field-values/<field_id>/   -> upsert one
      DELETE issues/<issue_id>/field-values/<field_id>/   -> clear one
    Permission: project ADMIN+MEMBER read & write values.
    """

    serializer_class = WorkItemFieldValueSerializer
    model = WorkItemFieldValue

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("field")
            .distinct()
        )

    def _active_field_or_none(self, slug, project_id, field_id):
        return (
            WorkItemField.objects.filter(
                pk=field_id,
                project_id=project_id,
                workspace__slug=slug,
                is_active=True,
            )
            .first()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id, issue_id):
        values = self.get_queryset()
        return Response(WorkItemFieldValueSerializer(values, many=True).data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def upsert(self, request, slug, project_id, issue_id, field_id):
        field = self._active_field_or_none(slug, project_id, field_id)
        if not field:
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        value_row = (
            WorkItemFieldValue.objects.filter(
                issue_id=issue_id, field_id=field_id
            ).first()
            or WorkItemFieldValue(issue_id=issue_id, field=field)
        )
        try:
            assign_field_value(value_row, field, request.data.get("value"))
        except Exception as exc:
            detail = getattr(exc, "detail", None) or str(exc)
            return Response({"error": detail}, status=status.HTTP_400_BAD_REQUEST)
        value_row.project_id = project_id
        value_row.save()
        return Response(
            WorkItemFieldValueSerializer(value_row).data, status=status.HTTP_200_OK
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def clear(self, request, slug, project_id, issue_id, field_id):
        value_row = self.get_queryset().filter(field_id=field_id).first()
        if value_row:
            value_row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemFieldValueBulkEndpoint(BaseAPIView):
    """Bulk hydrate custom field values for a project's issues.

    Design §5/§6: avoids N+1 in list view. Deliberately a *dedicated*
    endpoint rather than hooking the core issue-list serializer's
    ``expand`` machinery -- that hot path is shared with the list-view
    PRs (PR2/PR3) and high-risk to mutate. Same goal: one request
    hydrates the value cache.

    URL: .../projects/<uuid:project_id>/issue-field-values/
    Optional ``?issue_ids=<uuid,uuid>`` to scope to visible issues;
    otherwise returns every value in the project (rows are sparse).
    Returns ``{ "<issue_id>": { "<field_id>": <value> } }``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        queryset = (
            WorkItemFieldValue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("field")
            .distinct()
        )

        issue_ids_param = request.query_params.get("issue_ids")
        if issue_ids_param:
            ids = [i for i in issue_ids_param.split(",") if i]
            queryset = queryset.filter(issue_id__in=ids)

        result = {}
        for row in queryset:
            issue_key = str(row.issue_id)
            result.setdefault(issue_key, {})[str(row.field_id)] = (
                serialize_field_value(row.field, row)
            )
        return Response(result, status=status.HTTP_200_OK)
