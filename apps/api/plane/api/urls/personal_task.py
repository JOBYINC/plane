# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.personal_task import PersonalTaskAPIEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/personal-tasks/",
        PersonalTaskAPIEndpoint.as_view(http_method_names=["post"]),
        name="personal-tasks",
    ),
    path(
        "workspaces/<str:slug>/personal-tasks/<uuid:work_item_id>/",
        PersonalTaskAPIEndpoint.as_view(http_method_names=["patch"]),
        name="personal-task-detail",
    ),
]
