# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import WorkItemField, WorkItemFieldOption, WorkItemFieldValue

# The value (de)serialization is non-trivial (field_type -> typed column
# mapping). Reuse the single source of truth from the internal serializer
# module rather than duplicating it here — these helpers are pure model logic,
# not session/request bound, so they are safe to call from the public API.
from plane.app.serializers.work_item_field import (
    assign_field_value,
    serialize_field_value,
)

__all__ = [
    "WorkItemFieldOptionSerializer",
    "WorkItemFieldSerializer",
    "WorkItemFieldValueSerializer",
    "assign_field_value",
    "serialize_field_value",
]


class WorkItemFieldOptionSerializer(BaseSerializer):
    """A single selectable option of a single_select / multi_select field."""

    class Meta:
        model = WorkItemFieldOption
        fields = [
            "id",
            "field",
            "project_id",
            "workspace_id",
            "name",
            "color",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = [
            "field",
            "workspace",
            "project",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]


class WorkItemFieldSerializer(BaseSerializer):
    """A custom field schema definition scoped to a project."""

    # Hydrated for single_select / multi_select; empty list otherwise.
    options = WorkItemFieldOptionSerializer(many=True, read_only=True)

    class Meta:
        model = WorkItemField
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "field_type",
            "sort_order",
            "is_required",
            "is_active",
            "description",
            "config",
            "options",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "options",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

    def validate_field_type(self, value):
        valid = {t[0] for t in WorkItemField.FieldType.choices}
        if value not in valid:
            raise serializers.ValidationError(f"invalid field_type {value!r}")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name cannot be blank")
        return value

    def validate_config(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("config must be an object")
        return value


class WorkItemFieldValueSerializer(BaseSerializer):
    """A custom field's value on a single work item.

    ``value`` is rendered via the shared type-aware helper so the public API
    returns the same shape the internal API does (text / number / ISO date /
    list of option ids depending on field_type).
    """

    value = serializers.SerializerMethodField()

    class Meta:
        model = WorkItemFieldValue
        fields = [
            "id",
            "field",
            "issue",
            "project_id",
            "workspace_id",
            "value",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_value(self, obj):
        return serialize_field_value(obj.field, obj)
