# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""H5 JSSDK signature endpoint for Lark-embedded webapp pages.

The /lark-quick-create page (and any future Lark-embedded route) POSTs the
current page URL here and gets back an h5sdk.config payload. Signature is
single-use-per-URL; the page can re-call this endpoint after navigation.
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.utils.lark_jssdk import build_h5_config

logger = logging.getLogger("plane.app.views.lark.jssdk_signature")

MAX_URL_LENGTH = 2048


class LarkJsSdkSignatureEndpoint(APIView):
    """Returns a signed h5sdk.config payload for the URL the caller is on.

    Auth: standard Plane auth. We don't accept the URL from untrusted
    callers -- only logged-in Tick users can mint signatures, so a leaked
    endpoint cannot be used to grief Lark rate limits.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        url = (request.data.get("url") or "").strip()
        if not url:
            return Response(
                {"error": "url is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(url) > MAX_URL_LENGTH:
            return Response(
                {"error": "url too long"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (url.startswith("https://") or url.startswith("http://")):
            return Response(
                {"error": "url must include http(s) scheme"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = build_h5_config(url)
        if payload is None:
            logger.warning("Lark JSSDK config mint failed for url=%s", url)
            return Response(
                {"error": "lark credentials unavailable"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(payload, status=status.HTTP_200_OK)
