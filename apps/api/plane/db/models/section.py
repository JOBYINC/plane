# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .project import ProjectBaseModel


class ProjectSection(ProjectBaseModel):
    """An ordered, free-form organizational bucket within a project.

    No workflow semantics — purely how the user groups work items. This is a
    parallel, independent axis to State: Sections never read or write State,
    and grouping by section is by ``section_id`` only.

    See docs/sections-design.md §2 (the non-negotiable hard constraint) and
    §3 (data model). Named ``ProjectSection`` to avoid ``Section`` collisions.
    """

    name = models.CharField(max_length=255)
    sort_order = models.FloatField(default=65535.0)
    is_collapsed_default = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)

    def __str__(self):
        """Return name of the section"""
        return f"{self.name} <{self.project.name}>"

    class Meta:
        unique_together = [["project", "name"]]
        verbose_name = "Project Section"
        verbose_name_plural = "Project Sections"
        db_table = "project_sections"
        ordering = ("sort_order",)
        indexes = [
            models.Index(
                fields=["project", "is_archived", "sort_order"],
                name="psec_proj_arch_sort_idx",
            ),
        ]
