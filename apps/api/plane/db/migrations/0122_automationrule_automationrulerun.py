# Generated for Automation Engine v1.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationRule",
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
                ("description", models.TextField(blank=True, default="")),
                (
                    "trigger_type",
                    models.CharField(
                        choices=[
                            ("state_changed", "State changed"),
                            ("assignee_added", "Assignee added"),
                            ("assignee_removed", "Assignee removed"),
                            ("priority_changed", "Priority changed"),
                            ("target_date_changed", "Target date changed"),
                            ("labels_changed", "Labels changed"),
                            ("comment_added", "Comment added"),
                            ("due_soon", "Due soon"),
                            ("scheduled", "Scheduled (cron)"),
                        ],
                        max_length=64,
                    ),
                ),
                ("trigger_config", models.JSONField(blank=True, default=dict)),
                ("conditions", models.JSONField(blank=True, default=list)),
                ("actions", models.JSONField(blank=True, default=list)),
                ("is_active", models.BooleanField(default=True)),
                ("last_fired_at", models.DateTimeField(blank=True, null=True)),
                ("fire_count", models.PositiveIntegerField(default=0)),
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
                "verbose_name": "Automation Rule",
                "verbose_name_plural": "Automation Rules",
                "db_table": "automation_rules",
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="AutomationRuleRun",
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
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("success", "Success"),
                            ("skipped_condition", "Skipped (condition not met)"),
                            ("skipped_dedup", "Skipped (dedup)"),
                            ("skipped_loop", "Skipped (loop guard)"),
                            ("error", "Error"),
                        ],
                        max_length=32,
                    ),
                ),
                ("detail", models.JSONField(blank=True, default=dict)),
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
                    "issue",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="automation_runs",
                        to="db.issue",
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
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="runs",
                        to="db.automationrule",
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
                "verbose_name": "Automation Rule Run",
                "verbose_name_plural": "Automation Rule Runs",
                "db_table": "automation_rule_runs",
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="automationrule",
            index=models.Index(
                fields=["project", "is_active", "trigger_type"],
                name="automation__project_3b5e9a_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="automationrulerun",
            index=models.Index(
                fields=["rule", "-created_at"],
                name="automation__rule_id_7c1a2f_idx",
            ),
        ),
    ]
