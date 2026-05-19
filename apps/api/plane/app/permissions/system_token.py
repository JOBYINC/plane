# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.permissions import BasePermission

from plane.db.models import APIToken


class IsSystemToken(BasePermission):
    """Grant access only to API tokens flagged ``is_service=True``.

    The flag is DB-only — there is no API self-grant path; the same
    convention already used by the existing service-tier rate-limit
    bypass (see ``BaseAPIView.get_throttles``). Use this permission on
    endpoints that act on behalf of workspace members other than the
    token's own owner (cross-user writes into personal projects,
    workspace-wide assignee scans), where ordinary token holders must
    not be allowed.

    Implementation note: ``APIKeyAuthentication.authenticate`` returns
    ``request.auth = api_token.token`` (the raw string), not the model,
    so this class re-queries ``APIToken`` from the X-Api-Key header —
    same pattern as ``BaseAPIView.get_throttles``.
    """

    def has_permission(self, request, view):
        token_value = request.headers.get("X-Api-Key")
        if not token_value:
            return False
        return APIToken.objects.filter(
            token=token_value, is_service=True, is_active=True
        ).exists()
