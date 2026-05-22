# Flip project default visibility to Private (Secret/0) and backfill all
# existing Public (network=2) projects to Private. Asana-style: projects
# are private to their members, but anyone in the workspace can still be
# added (including via auto-add when assigned a work item — handled in
# IssueCreateSerializer.validate()).
#
# Backfill scope: all existing projects where network=2, EXCEPT:
#   - is_template=True (templates live in their own sidebar group and are
#     filtered out of the normal project list regardless of network; their
#     visibility is governed by the template list view)
#   - is_personal=True (personal "My Tasks" buckets are filtered by
#     personal_owner; network is irrelevant)
# Both exclusions are no-ops behaviourally; they're kept here to make the
# data migration's intent obvious.
#
# One-shot: this migration is intentionally destructive in the sense that
# previously-Public projects become invisible to non-members. Projects
# meant to stay company-wide must be manually flipped back to Public in
# project settings after deploy.

from django.db import migrations, models


def backfill_to_private(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    Project.objects.filter(
        network=2,
        is_template=False,
        is_personal=False,
    ).update(network=0)


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0129_project_is_template"),
    ]

    operations = [
        migrations.AlterField(
            model_name="project",
            name="network",
            field=models.PositiveSmallIntegerField(
                choices=[(0, "Secret"), (2, "Public")],
                default=0,
            ),
        ),
        # Reverse is intentionally a no-op: by the time anyone unwinds
        # this migration the database is likely to contain projects that
        # were created Private after deploy, plus projects manually
        # flipped between Public/Private. There's no safe automatic
        # restore — anyone rolling back must reset visibility manually.
        migrations.RunPython(backfill_to_private, reverse_code=migrations.RunPython.noop),
    ]
