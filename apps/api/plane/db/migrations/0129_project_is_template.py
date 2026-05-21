# Project templates: a flag marking a project as the workspace's canonical
# template (used as the source for ProjectDuplicateEndpoint). Hidden from
# the normal project list (same convention as ``is_personal``); surfaced
# in a dedicated sidebar "模版" group with a "create launch from this
# template" affordance.
#
# Pure additive AddField (no data migration): existing projects keep
# is_template=False. Reverse simply drops the column.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0128_apiactivitylog_on_behalf_of"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="is_template",
            field=models.BooleanField(default=False, db_index=True),
        ),
    ]
