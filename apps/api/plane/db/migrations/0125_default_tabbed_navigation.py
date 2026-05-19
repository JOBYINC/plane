# Default the project sidebar navigation to TABBED (was ACCORDION).
#
# Two parts:
#   1. AlterField — new WorkspaceUserProperties rows default to TABBED.
#   2. Data migration — flip every existing row still on "ACCORDION" to
#      "TABBED" so the change applies to current users too (the model
#      default alone never touches existing rows).
#
# Reverse is a no-op: once flipped we cannot tell which rows were
# originally ACCORDION by deliberate choice vs. the old silent default,
# so we do not blindly flip everything back.

from django.db import migrations, models


def set_tabbed(apps, schema_editor):
    WorkspaceUserProperties = apps.get_model("db", "WorkspaceUserProperties")
    WorkspaceUserProperties.objects.filter(
        navigation_control_preference="ACCORDION"
    ).update(navigation_control_preference="TABBED")


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0124_workitemfield_workitemfieldoption_workitemfieldvalue"),
    ]

    operations = [
        migrations.AlterField(
            model_name="workspaceuserproperties",
            name="navigation_control_preference",
            field=models.CharField(
                choices=[("ACCORDION", "Accordion"), ("TABBED", "Tabbed")],
                default="TABBED",
                max_length=25,
            ),
        ),
        migrations.RunPython(set_tabbed, migrations.RunPython.noop),
    ]
