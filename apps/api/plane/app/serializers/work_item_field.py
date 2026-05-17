# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from decimal import Decimal, InvalidOperation

from django.utils.dateparse import parse_date

from rest_framework import serializers

from plane.db.models import (
    ProjectMember,
    WorkItemField,
    WorkItemFieldOption,
    WorkItemFieldValue,
)
from .base import BaseSerializer

# Field types that own a set of selectable options.
_OPTION_FIELD_TYPES = {
    WorkItemField.FieldType.SINGLE_SELECT,
    WorkItemField.FieldType.MULTI_SELECT,
}


class WorkItemFieldOptionSerializer(BaseSerializer):
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
    # Hydrated for single_select / multi_select; empty list otherwise. The
    # related manager already excludes soft-deleted rows; the client filters
    # is_active for display.
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


# ---------------------------------------------------------------------------
# Value layer (design §3 field_type -> column mapping)
# ---------------------------------------------------------------------------

# Columns cleared on every upsert before the type-specific one is set, so a
# row never carries stale values from a previous (or wrong) type.
_ALL_VALUE_COLUMNS = ("value_text", "value_number", "value_date", "value_multi")


def serialize_field_value(field, value_row):
    """Normalize a WorkItemFieldValue row into a single JSON-friendly value."""
    ft = field.field_type
    if ft == WorkItemField.FieldType.TEXT:
        return value_row.value_text
    if ft == WorkItemField.FieldType.NUMBER:
        return None if value_row.value_number is None else float(value_row.value_number)
    if ft == WorkItemField.FieldType.DATE:
        return None if value_row.value_date is None else value_row.value_date.isoformat()
    if ft == WorkItemField.FieldType.SINGLE_SELECT:
        return value_row.value_text
    # multi_select / people
    return list(value_row.value_multi or [])


def _active_option_ids(field):
    return set(
        str(oid)
        for oid in WorkItemFieldOption.objects.filter(
            field=field, is_active=True
        ).values_list("id", flat=True)
    )


def _project_member_ids(field):
    return set(
        str(mid)
        for mid in ProjectMember.objects.filter(
            project_id=field.project_id, is_active=True
        ).values_list("member_id", flat=True)
    )


def assign_field_value(value_row, field, raw_value):
    """Validate `raw_value` for `field.field_type` and write it onto
    `value_row` (clearing all other typed columns). Raises
    serializers.ValidationError on a bad payload. Does not save."""
    for col in _ALL_VALUE_COLUMNS:
        setattr(value_row, col, None)

    ft = field.field_type

    if ft == WorkItemField.FieldType.TEXT:
        value_row.value_text = "" if raw_value is None else str(raw_value)
        return

    if ft == WorkItemField.FieldType.NUMBER:
        if raw_value is None or raw_value == "":
            value_row.value_number = None
            return
        try:
            value_row.value_number = Decimal(str(raw_value))
        except (InvalidOperation, ValueError):
            raise serializers.ValidationError("value must be a number")
        return

    if ft == WorkItemField.FieldType.DATE:
        if raw_value is None or raw_value == "":
            value_row.value_date = None
            return
        parsed = parse_date(str(raw_value))
        if parsed is None:
            raise serializers.ValidationError("value must be a YYYY-MM-DD date")
        value_row.value_date = parsed
        return

    if ft == WorkItemField.FieldType.SINGLE_SELECT:
        if raw_value in (None, ""):
            value_row.value_text = None
            return
        if str(raw_value) not in _active_option_ids(field):
            raise serializers.ValidationError("value is not a valid option for this field")
        value_row.value_text = str(raw_value)
        return

    if ft == WorkItemField.FieldType.MULTI_SELECT:
        if not isinstance(raw_value, list):
            raise serializers.ValidationError("value must be a list of option ids")
        valid = _active_option_ids(field)
        ids = [str(v) for v in raw_value]
        bad = [i for i in ids if i not in valid]
        if bad:
            raise serializers.ValidationError(f"invalid option ids: {bad}")
        value_row.value_multi = ids
        return

    if ft == WorkItemField.FieldType.PEOPLE:
        if not isinstance(raw_value, list):
            raise serializers.ValidationError("value must be a list of member ids")
        members = _project_member_ids(field)
        ids = [str(v) for v in raw_value]
        bad = [i for i in ids if i not in members]
        if bad:
            raise serializers.ValidationError(f"users not in project: {bad}")
        value_row.value_multi = ids
        return

    raise serializers.ValidationError(f"unsupported field_type {ft!r}")


class WorkItemFieldValueSerializer(BaseSerializer):
    value = serializers.SerializerMethodField()

    class Meta:
        model = WorkItemFieldValue
        fields = [
            "id",
            "field",
            "issue",
            "value",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_value(self, obj):
        field = getattr(obj, "field", None)
        if field is None:
            return None
        return serialize_field_value(field, obj)
