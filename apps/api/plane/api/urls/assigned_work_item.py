# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.assigned_work_item import AssignedWorkItemAPIEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/assigned-work-items/",
        AssignedWorkItemAPIEndpoint.as_view(http_method_names=["get"]),
        name="assigned-work-items",
    ),
]
