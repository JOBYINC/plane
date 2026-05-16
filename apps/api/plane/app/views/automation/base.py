# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    AutomationRuleRunSerializer,
    AutomationRuleSerializer,
)
from plane.db.models import AutomationRule, AutomationRuleRun
from .. import BaseAPIView, BaseViewSet


class AutomationRuleViewSet(BaseViewSet):
    """CRUD over `AutomationRule`s scoped to a single project.

    URL: /api/v1/workspaces/<slug>/projects/<uuid:project_id>/automation-rules/
    Permission: project ADMIN only -- automation can move tickets, page
    people, and hit webhooks; non-admins shouldn't be able to configure
    that even if they can edit issues directly.
    """

    serializer_class = AutomationRuleSerializer
    model = AutomationRule

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project", "workspace")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN])
    def list(self, request, slug, project_id):
        rules = self.get_queryset().order_by("-created_at")
        return Response(AutomationRuleSerializer(rules, many=True).data)

    @allow_permission([ROLE.ADMIN])
    def retrieve(self, request, slug, project_id, pk):
        rule = self.get_queryset().filter(pk=pk).first()
        if not rule:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(AutomationRuleSerializer(rule).data)

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        serializer = AutomationRuleSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(project_id=project_id)
        self._kick_scheduled_if_applicable(serializer.instance)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, slug, project_id, pk):
        rule = self.get_queryset().filter(pk=pk).first()
        if not rule:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = AutomationRuleSerializer(rule, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        self._kick_scheduled_if_applicable(serializer.instance)
        return Response(serializer.data)

    def _kick_scheduled_if_applicable(self, rule):
        """Fire scheduled-rule evaluation right after save.

        Scheduled triggers (due_soon, future cron) normally only run via
        the hourly Celery beat job. Without this kick a user who saves
        a new rule waits up to 60 minutes to see anything happen, which
        reads as "the rule is broken." Bypass dedup so a re-saved rule
        re-fires even on issues that are still inside the dedup window
        from a recent beat-driven evaluation.
        """
        if not rule.is_active:
            return
        if rule.trigger_type not in ("due_soon", "scheduled"):
            return
        try:
            from plane.bgtasks.automation_scheduled_task import (
                evaluate_scheduled_automations_task,
            )

            evaluate_scheduled_automations_task.delay(
                rule_id=str(rule.id), bypass_dedup=True
            )
        except Exception:
            # Never fail the API response just because the kick couldn't queue.
            # The hourly beat will pick it up anyway.
            pass

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        rule = self.get_queryset().filter(pk=pk).first()
        if not rule:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        rule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AutomationRuleRunListView(BaseAPIView):
    """Read-only audit-log view for a single rule's run history.

    URL: /api/v1/workspaces/<slug>/projects/<uuid:project_id>/automation-rules/<uuid:rule_id>/runs/
    """

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id, rule_id):
        runs = (
            AutomationRuleRun.objects.filter(
                rule_id=rule_id,
                project_id=project_id,
                workspace__slug=slug,
            )
            .select_related("rule", "issue")
            .order_by("-created_at")[:200]
        )
        return Response(AutomationRuleRunSerializer(runs, many=True).data)
