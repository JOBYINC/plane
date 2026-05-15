# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from .base import BaseSerializer

from plane.db.models import ProjectSection


class ProjectSectionSerializer(BaseSerializer):
    """Serializer for free-form organizational sections.

    Pure container — carries NO workflow/State data by design (S1 hard
    constraint, docs/sections-design.md §2). `sort_order` is client-driven
    for reorder (float-between-neighbors, same trick as elsewhere in Plane).
    """

    class Meta:
        model = ProjectSection
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "sort_order",
            "is_collapsed_default",
            "is_archived",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "is_archived",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
