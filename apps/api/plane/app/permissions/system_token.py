# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.permissions import BasePermission


class IsSystemToken(BasePermission):
    """Grant access only to API tokens flagged ``is_service=True``.

    The flag is DB-only — there is no API self-grant path; the same
    convention already used by the existing service-tier rate-limit
    bypass (see ``BaseAPIView.get_throttles``). Use this permission on
    endpoints that act on behalf of workspace members other than the
    token's own owner (cross-user writes into personal projects,
    workspace-wide assignee scans), where ordinary token holders must
    not be allowed.
    """

    def has_permission(self, request, view):
        return bool(
            request.auth is not None
            and getattr(request.auth, "is_service", False)
        )
