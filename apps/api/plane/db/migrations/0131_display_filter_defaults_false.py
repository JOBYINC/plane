# Flip two `display_filters` extra-options defaults from True to False across
# all per-user / per-view containers: `show_empty_groups` and `sub_issue`.
# Code defaults already changed in the model files; this migration backfills
# existing rows so the new defaults apply to projects/users created before
# this deploy.
#
# Affected JSON containers (all hold a `display_filters` dict):
#   - CycleUserProperties.display_filters
#   - ModuleUserProperties.display_filters
#   - IssueView.display_filters
#   - ProjectUserProperty.display_filters
#   - WorkspaceUserProperties.display_filters
#
# Behaviour:
#   - show_empty_groups: with 500-member workspaces (Lark-synced) the True
#     default produced hundreds of empty assignee groups, drowning out real
#     data. Flipping to False mirrors Linear/Jira default.
#   - sub_issue: hide sub-issues in the main list/kanban by default. Users
#     who care about sub-issues can re-enable via Display filters → Extra
#     options. Sub-issues are still visible inside the parent issue detail.
#
# Conservative scope: only flip rows where the field is currently exactly
# True. Rows that have been explicitly set False (or are missing the key) are
# left untouched.

from django.db import migrations


_MODELS = [
    ("CycleUserProperties", "display_filters"),
    ("ModuleUserProperties", "display_filters"),
    ("IssueView", "display_filters"),
    ("ProjectUserProperty", "display_filters"),
    ("WorkspaceUserProperties", "display_filters"),
]

_KEYS_TO_FLIP = ["show_empty_groups", "sub_issue"]


def flip_to_false(apps, schema_editor):
    for model_name, field_name in _MODELS:
        Model = apps.get_model("db", model_name)
        for key in _KEYS_TO_FLIP:
            # JSONB filter: rows whose field has this key=True. Iterate-update
            # rather than vendor-specific jsonb_set SQL; per-user property
            # volume is small.
            qs = Model.objects.filter(**{f"{field_name}__{key}": True})
            to_update = []
            for row in qs.iterator(chunk_size=500):
                df = getattr(row, field_name) or {}
                df[key] = False
                setattr(row, field_name, df)
                to_update.append(row)
                if len(to_update) >= 500:
                    Model.objects.bulk_update(to_update, [field_name])
                    to_update = []
            if to_update:
                Model.objects.bulk_update(to_update, [field_name])


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0130_project_default_private_and_backfill"),
    ]

    # Reverse is a no-op: by the time anyone rolls back, users may have
    # toggled the field explicitly and we can't distinguish original True
    # from re-enabled True. Same pattern as 0130.
    operations = [
        migrations.RunPython(flip_to_false, reverse_code=migrations.RunPython.noop),
    ]
