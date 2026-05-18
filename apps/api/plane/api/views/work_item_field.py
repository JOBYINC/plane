# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

# Module imports
from plane.api.serializers import (
    WorkItemFieldSerializer,
    WorkItemFieldOptionSerializer,
    WorkItemFieldValueSerializer,
)
from plane.api.serializers.work_item_field import (
    assign_field_value,
    serialize_field_value,
)
from plane.app.permissions import ProjectAdminPermission, ProjectEntityPermission
from plane.db.models import (
    Issue,
    WorkItemField,
    WorkItemFieldOption,
    WorkItemFieldValue,
)
from .base import BaseAPIView

# --------------------------------------------------------------------------- #
# Public (API-token) access to project custom fields. Mirrors the internal app
# endpoints (plane/app/views/work_item_field) but uses the public BaseAPIView
# (APIKeyAuthentication), exactly like the State / Issue public endpoints.
# Inc1 read, Inc2 value writes, Inc3 schema CRUD. Reads = any project member;
# schema mutations (create/update/archive a field or option) = project ADMIN
# only, matching the internal @allow_permission([ROLE.ADMIN]) gate so an
# external token can't reshape a project's data model unless it is an admin.
# --------------------------------------------------------------------------- #


class _SchemaPermissionMixin:
    """Read for any project member; write (schema mutation) for admins only."""

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [ProjectEntityPermission()]
        return [ProjectAdminPermission()]


class WorkItemFieldListAPIEndpoint(_SchemaPermissionMixin, BaseAPIView):
    """List (any member) or create (admin) a project's custom field defs."""

    serializer_class = WorkItemFieldSerializer
    model = WorkItemField
    use_read_replica = True

    def get_queryset(self):
        return (
            WorkItemField.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .prefetch_related("options")
            .select_related("project", "workspace")
            .distinct()
        )

    def get(self, request, slug, project_id):
        fields = self.get_queryset().order_by("sort_order")
        return Response(
            WorkItemFieldSerializer(fields, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, slug, project_id):
        try:
            serializer = WorkItemFieldSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(
                    serializer.errors, status=status.HTTP_400_BAD_REQUEST
                )
            serializer.save(project_id=project_id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class WorkItemFieldDetailAPIEndpoint(_SchemaPermissionMixin, BaseAPIView):
    """Retrieve (member), update or archive (admin) a custom field def."""

    serializer_class = WorkItemFieldSerializer
    model = WorkItemField
    use_read_replica = True

    def get_queryset(self):
        return (
            WorkItemField.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .prefetch_related("options")
            .select_related("project", "workspace")
            .distinct()
        )

    def get(self, request, slug, project_id, field_id):
        field = self.get_queryset().filter(pk=field_id).first()
        if not field:
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(
            WorkItemFieldSerializer(field).data, status=status.HTTP_200_OK
        )

    def patch(self, request, slug, project_id, field_id):
        field = self.get_queryset().filter(pk=field_id).first()
        if not field:
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        try:
            serializer = WorkItemFieldSerializer(
                field, data=request.data, partial=True
            )
            if not serializer.is_valid():
                return Response(
                    serializer.errors, status=status.HTTP_400_BAD_REQUEST
                )
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def delete(self, request, slug, project_id, field_id):
        # Archive (mirrors internal: DELETE soft-deletes via is_active=False;
        # values stay and the name stays reserved while archived).
        field = self.get_queryset().filter(pk=field_id).first()
        if not field:
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        field.is_active = False
        field.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemFieldOptionListAPIEndpoint(_SchemaPermissionMixin, BaseAPIView):
    """List (member) or create (admin) a select field's options."""

    serializer_class = WorkItemFieldOptionSerializer
    model = WorkItemFieldOption
    use_read_replica = True

    def get_queryset(self):
        return (
            WorkItemFieldOption.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(field_id=self.kwargs.get("field_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("field", "project", "workspace")
            .distinct()
        )

    def _field_in_project(self, slug, project_id, field_id):
        return WorkItemField.objects.filter(
            pk=field_id, project_id=project_id, workspace__slug=slug
        ).exists()

    def get(self, request, slug, project_id, field_id):
        options = self.get_queryset().order_by("sort_order")
        return Response(
            WorkItemFieldOptionSerializer(options, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, slug, project_id, field_id):
        if not self._field_in_project(slug, project_id, field_id):
            return Response(
                {"error": "Field not found"}, status=status.HTTP_404_NOT_FOUND
            )
        try:
            serializer = WorkItemFieldOptionSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(
                    serializer.errors, status=status.HTTP_400_BAD_REQUEST
                )
            serializer.save(project_id=project_id, field_id=field_id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists on the field"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class WorkItemFieldOptionDetailAPIEndpoint(BaseAPIView):
    """Update or archive a single option (project admin only)."""

    serializer_class = WorkItemFieldOptionSerializer
    model = WorkItemFieldOption
    permission_classes = [ProjectAdminPermission]

    def get_queryset(self):
        return (
            WorkItemFieldOption.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(field_id=self.kwargs.get("field_id"))
            .select_related("field", "project", "workspace")
            .distinct()
        )

    def patch(self, request, slug, project_id, field_id, option_id):
        option = self.get_queryset().filter(pk=option_id).first()
        if not option:
            return Response(
                {"error": "Option not found"}, status=status.HTTP_404_NOT_FOUND
            )
        try:
            serializer = WorkItemFieldOptionSerializer(
                option, data=request.data, partial=True
            )
            if not serializer.is_valid():
                return Response(
                    serializer.errors, status=status.HTTP_400_BAD_REQUEST
                )
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists on the field"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def delete(self, request, slug, project_id, field_id, option_id):
        option = self.get_queryset().filter(pk=option_id).first()
        if not option:
            return Response(
                {"error": "Option not found"}, status=status.HTTP_404_NOT_FOUND
            )
        option.is_active = False
        option.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemFieldValueListAPIEndpoint(BaseAPIView):
    """List all custom field values set on a single work item."""

    serializer_class = WorkItemFieldValueSerializer
    model = WorkItemFieldValue
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        return (
            WorkItemFieldValue.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("field")
            .distinct()
        )

    def get(self, request, slug, project_id, issue_id):
        values = self.get_queryset()
        return Response(
            WorkItemFieldValueSerializer(values, many=True).data,
            status=status.HTTP_200_OK,
        )


class WorkItemFieldValueBulkAPIEndpoint(BaseAPIView):
    """Hydrate every custom field value in a project in one request.

    Optional ``?issue_ids=<uuid,uuid>`` scopes to specific work items;
    otherwise returns every value in the project (rows are sparse).
    Returns ``{ "<issue_id>": { "<field_id>": <value> } }``.
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

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
            result.setdefault(issue_key, {})[str(row.field_id)] = serialize_field_value(
                row.field, row
            )
        return Response(result, status=status.HTTP_200_OK)


class WorkItemFieldValueUpsertAPIEndpoint(BaseAPIView):
    """Set (PUT) or clear (DELETE) one custom field's value on a work item.

    This is the external-agent "auto-fill" path. Mirrors the internal
    upsert/clear logic (typed value coercion via the shared
    ``assign_field_value`` helper) but, being token-facing, additionally
    verifies the work item actually belongs to this project/workspace so a
    token scoped to project A cannot write a value onto project B's issue.
    """

    permission_classes = [ProjectEntityPermission]

    def _active_field(self, slug, project_id, field_id):
        return WorkItemField.objects.filter(
            pk=field_id,
            project_id=project_id,
            workspace__slug=slug,
            is_active=True,
        ).first()

    def _issue_in_project(self, slug, project_id, issue_id):
        return Issue.objects.filter(
            pk=issue_id,
            project_id=project_id,
            workspace__slug=slug,
        ).exists()

    def put(self, request, slug, project_id, issue_id, field_id):
        if not self._issue_in_project(slug, project_id, issue_id):
            return Response(
                {"error": "Work item not found in this project"},
                status=status.HTTP_404_NOT_FOUND,
            )
        field = self._active_field(slug, project_id, field_id)
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

    def delete(self, request, slug, project_id, issue_id, field_id):
        value_row = (
            WorkItemFieldValue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                issue_id=issue_id,
                field_id=field_id,
            )
            .filter(
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .first()
        )
        if value_row:
            value_row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
