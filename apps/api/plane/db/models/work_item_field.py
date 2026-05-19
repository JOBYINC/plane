# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from .project import ProjectBaseModel


class WorkItemField(ProjectBaseModel):
    """Schema definition of one custom field on a project.

    Naming intentionally avoids ``IssueProperty`` — the original
    ``IssueProperty`` was renamed to ``ProjectUserProperty`` (migration
    0114) and is now per-user view preferences, not a field schema.

    Six field types, mirroring Asana's set (no ``boolean`` — Asana models
    yes/no as a 2-option single-select):
    ``text``/``number``/``date``/``single_select``/``multi_select``/``people``.

    ``is_active`` is the product-level "archive" flag (DELETE endpoint sets
    it False); ``deleted_at`` is the framework soft-delete from
    ``SoftDeleteModel``. The natural key is scoped to live rows only via the
    partial UniqueConstraint so a name can be reused after a field is
    soft-deleted — matching Plane house style (Module/State/ProjectIssueType)
    and Asana, where a deleted field's name is not reserved.
    """

    class FieldType(models.TextChoices):
        TEXT = "text", "Text"
        NUMBER = "number", "Number"
        DATE = "date", "Date"
        SINGLE_SELECT = "single_select", "Single select"
        MULTI_SELECT = "multi_select", "Multi-select"
        PEOPLE = "people", "People"

    name = models.CharField(max_length=255)
    field_type = models.CharField(max_length=32, choices=FieldType.choices)
    sort_order = models.FloatField(default=65535.0)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True, default="")
    # Per-type config (e.g. number formatting, date format). JSONB for flexibility.
    config = models.JSONField(default=dict, blank=True)
    # External-integration idempotency keys (mirrors Issue / IssueType). The
    # public token API uses (project, external_source, external_id) for
    # GET-then-create so an agent's ensure_* is idempotent.
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        unique_together = [["project", "name", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_unique_project_name_when_deleted_at_null",
            )
        ]
        ordering = ["sort_order"]
        indexes = [
            models.Index(
                fields=["project", "is_active", "sort_order"],
                name="wif_proj_active_sort_idx",
            ),
        ]
        verbose_name = "Work Item Field"
        verbose_name_plural = "Work Item Fields"
        db_table = "work_item_fields"

    def __str__(self):
        return f"{self.name} ({self.field_type}) <{self.project_id}>"


class WorkItemFieldOption(ProjectBaseModel):
    """A selectable option. Only used by ``single_select`` / ``multi_select``."""

    field = models.ForeignKey(
        WorkItemField,
        related_name="options",
        on_delete=models.CASCADE,
    )
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=16, default="#6B7280")
    sort_order = models.FloatField(default=65535.0)
    is_active = models.BooleanField(default=True)
    # External-integration idempotency keys (mirrors Issue / IssueType). The
    # public token API uses (field, external_source, external_id) for
    # GET-then-create so an agent's ensure_* is idempotent.
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        unique_together = [["field", "name", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["field", "name"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_option_unique_field_name_when_deleted_at_null",
            )
        ]
        ordering = ["sort_order"]
        verbose_name = "Work Item Field Option"
        verbose_name_plural = "Work Item Field Options"
        db_table = "work_item_field_options"

    def __str__(self):
        return f"{self.name} <{self.field_id}>"


class WorkItemFieldValue(ProjectBaseModel):
    """Per-issue value for one field. Sparse — only rows that have a value exist.

    Exactly one ``value_*`` column is non-null per row, determined by
    ``field.field_type``. ``value_text`` covers ``single_select`` (= option
    UUID as a string); ``value_multi`` covers ``multi_select`` (option UUIDs)
    and ``people`` (workspace member UUIDs). The serializer enforces the
    field_type → column mapping.
    """

    issue = models.ForeignKey(
        "db.Issue",
        related_name="field_values",
        on_delete=models.CASCADE,
    )
    field = models.ForeignKey(
        WorkItemField,
        related_name="values",
        on_delete=models.CASCADE,
    )
    value_text = models.TextField(null=True, blank=True)
    value_number = models.DecimalField(
        max_digits=24, decimal_places=8, null=True, blank=True
    )
    value_date = models.DateField(null=True, blank=True)
    value_multi = ArrayField(
        models.CharField(max_length=255), null=True, blank=True
    )

    class Meta:
        unique_together = [["issue", "field", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "field"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_value_unique_issue_field_when_deleted_at_null",
            )
        ]
        indexes = [
            models.Index(
                fields=["field", "value_text"], name="wifv_field_value_text_idx"
            ),
            models.Index(
                fields=["field", "value_number"],
                name="wifv_field_value_number_idx",
            ),
            models.Index(
                fields=["field", "value_date"], name="wifv_field_value_date_idx"
            ),
        ]
        verbose_name = "Work Item Field Value"
        verbose_name_plural = "Work Item Field Values"
        db_table = "work_item_field_values"

    def __str__(self):
        return f"value<{self.field_id} issue={self.issue_id}>"
