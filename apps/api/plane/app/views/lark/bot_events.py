# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP entry point for Lark bot event subscriptions.

Lark POSTs every bot event (URL preview requests, card button callbacks,
configuration challenges) to this single endpoint. Signature is verified
before any DB work happens. Logic stays in plane.utils.lark_bot_events so
this file remains a thin dispatcher.
"""

# Python imports
import json
import logging

# Django imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.utils.lark_bot_events import (
    build_url_preview_card,
    decrypt_lark_payload,
    encrypt_key,
    lookup_issue_for_url,
    verification_token,
    verify_lark_request,
)

logger = logging.getLogger("plane.app.views.lark.bot_events")


class LarkBotEventEndpoint(APIView):
    """Unauthenticated webhook for the Lark Bot Open Platform.

    Lark calls this with signed POSTs and expects either:
      - {"challenge": "..."} during URL verification, or
      - {"preview_list": [...]} for url_preview requests, or
      - any 2xx for fire-and-forget events (e.g. card actions).
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        body_bytes = request.body or b""
        if not verify_lark_request(request.headers, body_bytes):
            logger.warning("Lark bot event signature failed; dropping")
            return Response({"error": "bad signature"}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = json.loads(body_bytes or b"{}")
        except json.JSONDecodeError:
            return Response({"error": "invalid json"}, status=status.HTTP_400_BAD_REQUEST)

        # ---- 0. Decrypt if Lark wrapped the body (encrypt_key configured) ----
        # When the app has an Encrypt Key set in the Lark console, every event
        # arrives as {"encrypt": "<base64-aes-ciphertext>"} instead of plain
        # JSON. Decrypt-to-inner-payload here so all downstream logic only
        # ever sees the cleartext shape.
        if isinstance(payload, dict) and payload.get("encrypt") and encrypt_key():
            inner = decrypt_lark_payload(payload["encrypt"])
            if inner is None:
                logger.warning("Failed to decrypt Lark payload")
                return Response({"error": "decrypt failed"}, status=status.HTTP_400_BAD_REQUEST)
            payload = inner

        # ---- 1. URL verification challenge (one-time during URL config) ----
        if payload.get("type") == "url_verification":
            expected_token = verification_token()
            if expected_token and payload.get("token") != expected_token:
                return Response({"error": "bad token"}, status=status.HTTP_401_UNAUTHORIZED)
            return Response({"challenge": payload.get("challenge")})

        # ---- 2. Real bot events ----
        header = payload.get("header") or {}
        event_type = header.get("event_type") or ""

        # Defence in depth: verify body-level token when present alongside
        # signature check. Lark's own header signature is the primary gate.
        expected_token = verification_token()
        if expected_token and header.get("token") and header["token"] != expected_token:
            return Response({"error": "bad token"}, status=status.HTTP_401_UNAUTHORIZED)

        if event_type in ("url_preview.get_v1", "url.preview.get_v1"):
            return self._handle_url_preview(payload)

        # Unknown event types: ack 200 to stop Lark from retrying, but log
        # so we notice things we haven't wired up yet (card.action.trigger
        # etc. will land here until Day 3-4).
        logger.info("Unhandled Lark bot event_type=%s", event_type)
        return Response({"ok": True})

    def _handle_url_preview(self, payload):
        event = payload.get("event") or {}
        url_list = event.get("url_list") or []
        if not isinstance(url_list, list):
            url_list = []

        preview_list = []
        for url in url_list:
            try:
                issue = lookup_issue_for_url(url)
            except Exception:
                logger.exception("URL preview lookup failed for %s", url)
                issue = None

            if issue is None:
                # Lark accepts entries with `inline_message` empty/absent to
                # signal "we don't have a preview for this URL". Skip rather
                # than emit a 404-style card; lets other registered preview
                # apps (if any) take a turn.
                continue

            preview_list.append(
                {
                    "url": url,
                    "inline_message": {
                        "title": f"📋 {issue.name[:80]}",
                        "card": build_url_preview_card(issue),
                    },
                }
            )

        return Response({"preview_list": preview_list})
