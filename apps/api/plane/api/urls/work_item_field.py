# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import (
    WorkItemFieldListAPIEndpoint,
    WorkItemFieldDetailAPIEndpoint,
    WorkItemFieldOptionListAPIEndpoint,
    WorkItemFieldValueListAPIEndpoint,
    WorkItemFieldValueBulkAPIEndpoint,
    WorkItemFieldValueUpsertAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/",
        WorkItemFieldListAPIEndpoint.as_view(http_method_names=["get"]),
        name="work-item-fields",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/<uuid:field_id>/",
        WorkItemFieldDetailAPIEndpoint.as_view(http_method_names=["get"]),
        name="work-item-field-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/fields/<uuid:field_id>/options/",
        WorkItemFieldOptionListAPIEndpoint.as_view(http_method_names=["get"]),
        name="work-item-field-options",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/field-values/",
        WorkItemFieldValueListAPIEndpoint.as_view(http_method_names=["get"]),
        name="work-item-field-values",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/field-values/<uuid:field_id>/",
        WorkItemFieldValueUpsertAPIEndpoint.as_view(http_method_names=["put", "delete"]),
        name="work-item-field-value-upsert",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-field-values/",
        WorkItemFieldValueBulkAPIEndpoint.as_view(http_method_names=["get"]),
        name="work-item-field-values-bulk",
    ),
]
