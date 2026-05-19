# Personal projects: a per-user private bucket for project-less ("My Tasks")
# work items. Adds two nullable/defaulted columns to Project:
#   - is_personal: marks the hidden personal bucket (excluded from normal
#     project lists).
#   - personal_owner: the single owning user; CASCADE so the bucket is
#     removed with its owner.
#
# Pure additive AddField (no data migration): existing projects keep
# is_personal=False / personal_owner=NULL. Reverse simply drops the columns.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0125_default_tabbed_navigation"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="is_personal",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="project",
            name="personal_owner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="personal_projects",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
