# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    WorkItemFieldViewSet,
    WorkItemFieldOptionViewSet,
    WorkItemFieldValueViewSet,
    WorkItemFieldValueBulkEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/",
        WorkItemFieldViewSet.as_view({"get": "list", "post": "create"}),
        name="project-work-item-fields",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/<uuid:pk>/",
        WorkItemFieldViewSet.as_view(
            {
                "get": "retrieve",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-work-item-field",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/<uuid:field_id>/options/",
        WorkItemFieldOptionViewSet.as_view({"get": "list", "post": "create"}),
        name="project-work-item-field-options",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/<uuid:field_id>/options/<uuid:pk>/",
        WorkItemFieldOptionViewSet.as_view(
            {
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-work-item-field-option",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/field-values/",
        WorkItemFieldValueViewSet.as_view({"get": "list"}),
        name="project-work-item-field-values",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/field-values/<uuid:field_id>/",
        WorkItemFieldValueViewSet.as_view({"put": "upsert", "delete": "clear"}),
        name="project-work-item-field-value",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-field-values/",
        WorkItemFieldValueBulkEndpoint.as_view(),
        name="project-work-item-field-values-bulk",
    ),
]
