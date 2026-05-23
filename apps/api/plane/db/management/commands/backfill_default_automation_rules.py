# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Backfill the 4 default automation rules onto every non-archived
project.

Run shape:
    docker compose exec api python manage.py backfill_default_automation_rules

Scope:
    Project.objects.filter(archived_at__isnull=True) — covers active,
    template, and personal projects (per Marcus's spec). Archived
    projects are skipped; the engine doesn't fire on them anyway.

Idempotent: ``create_default_automation_rules_for_project`` already
skips rules whose ``name`` matches an existing rule on the project,
so running this command multiple times only installs the missing
defaults. Safe to re-run.
"""

from django.core.management import BaseCommand

from plane.db.models import Project
from plane.utils.automation_templates import create_default_automation_rules_for_project


class Command(BaseCommand):
    help = "Ensure each non-archived project has the 4 default automation rules."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        projects = Project.objects.filter(archived_at__isnull=True).select_related("workspace")
        total = projects.count()
        installed_per_project: dict[str, int] = {}
        scanned = 0

        for project in projects:
            scanned += 1
            if dry_run:
                # Count what we'd install without writing.
                from plane.db.models import AutomationRule
                from plane.utils.automation_templates import DEFAULT_AUTOMATION_RULES

                existing = set(
                    AutomationRule.objects.filter(project=project).values_list("name", flat=True)
                )
                missing = [tpl["name"] for tpl in DEFAULT_AUTOMATION_RULES if tpl["name"] not in existing]
                if missing:
                    installed_per_project[str(project.id)] = len(missing)
                    self.stdout.write(
                        f"[dry-run] {project.workspace.slug}/{project.name} ({project.id}): "
                        f"would install {len(missing)} rules: {missing}"
                    )
            else:
                installed = create_default_automation_rules_for_project(project)
                if installed:
                    installed_per_project[str(project.id)] = installed
                    self.stdout.write(
                        f"{project.workspace.slug}/{project.name} ({project.id}): "
                        f"installed {installed} rules"
                    )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nScanned: {scanned} project(s). "
                f"{'Would install' if dry_run else 'Installed'} rules on "
                f"{len(installed_per_project)} project(s), "
                f"{sum(installed_per_project.values())} rule(s) total."
            )
        )
