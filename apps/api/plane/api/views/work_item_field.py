# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
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
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import (
    Issue,
    WorkItemField,
    WorkItemFieldOption,
    WorkItemFieldValue,
)
from .base import BaseAPIView

# --------------------------------------------------------------------------- #
# Public (API-token) read access to project custom fields. Mirrors the
# internal app endpoints (plane/app/views/work_item_field) but uses the public
# BaseAPIView (APIKeyAuthentication) + ProjectEntityPermission, exactly like
# the State / Issue public endpoints. Inc 1 = READ ONLY (list/retrieve);
# writing field values and CRUD over field schemas land in later increments.
# --------------------------------------------------------------------------- #


class WorkItemFieldListAPIEndpoint(BaseAPIView):
    """List a project's custom field definitions."""

    serializer_class = WorkItemFieldSerializer
    model = WorkItemField
    permission_classes = [ProjectEntityPermission]
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


class WorkItemFieldDetailAPIEndpoint(BaseAPIView):
    """Retrieve a single custom field definition."""

    serializer_class = WorkItemFieldSerializer
    model = WorkItemField
    permission_classes = [ProjectEntityPermission]
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


class WorkItemFieldOptionListAPIEndpoint(BaseAPIView):
    """List the selectable options of a single_select / multi_select field."""

    serializer_class = WorkItemFieldOptionSerializer
    model = WorkItemFieldOption
    permission_classes = [ProjectEntityPermission]
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

    def get(self, request, slug, project_id, field_id):
        options = self.get_queryset().order_by("sort_order")
        return Response(
            WorkItemFieldOptionSerializer(options, many=True).data,
            status=status.HTTP_200_OK,
        )


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
