# Generated for Free-form Sections v1 (Strategy S1) — step 1.
#
# MIGRATION NUMBERING — see docs/sections-design.md §4 (the one coordination
# point with feature/custom-fields). This branch and feature/custom-fields
# both forked when 0122 was the latest migration. custom-fields creates 0123;
# this branch creates 0124 and depends on 0122 (NOT 0123 — it does not exist
# on this branch). The number and dependency are pinned BY HAND on purpose;
# do not let `makemigrations` auto-number this (it would emit 0123 and
# silently collide with custom-fields).
#
# On merge: whichever of the two branches merges to mainline SECOND rebases
# its migration's `dependencies` onto the other branch's leaf (or runs
# `makemigrations --merge`). Record the chosen leaf in the merge PR. Never
# renumber a migration already applied on a running environment.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0122_automationrule_automationrulerun"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectSection",
            fields=[
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(
                        auto_now=True, verbose_name="Last Modified At"
                    ),
                ),
                (
                    "deleted_at",
                    models.DateTimeField(
                        blank=True, null=True, verbose_name="Deleted At"
                    ),
                ),
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("name", models.CharField(max_length=255)),
                ("sort_order", models.FloatField(default=65535.0)),
                ("is_collapsed_default", models.BooleanField(default=False)),
                ("is_archived", models.BooleanField(default=False)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="project_%(class)s",
                        to="db.project",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="workspace_%(class)s",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Project Section",
                "verbose_name_plural": "Project Sections",
                "db_table": "project_sections",
                "ordering": ("sort_order",),
                "unique_together": {("project", "name")},
            },
        ),
        migrations.AddField(
            model_name="issue",
            name="section",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="issues",
                to="db.projectsection",
            ),
        ),
        migrations.AddIndex(
            model_name="projectsection",
            index=models.Index(
                fields=["project", "is_archived", "sort_order"],
                name="psec_proj_arch_sort_idx",
            ),
        ),
    ]
