# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import AutomationRuleRunListView, AutomationRuleViewSet


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automation-rules/",
        AutomationRuleViewSet.as_view({"get": "list", "post": "create"}),
        name="project-automation-rules",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automation-rules/<uuid:pk>/",
        AutomationRuleViewSet.as_view(
            {
                "get": "retrieve",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-automation-rule",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automation-rules/<uuid:rule_id>/runs/",
        AutomationRuleRunListView.as_view(),
        name="project-automation-rule-runs",
    ),
]
