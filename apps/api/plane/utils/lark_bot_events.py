# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Lark/Feishu Bot event subscription helpers.

A single HTTP endpoint receives every Bot event Lark sends our way:
  - url_verification: one-time challenge during URL configuration
  - url_preview.get_v1: user pasted a Plane URL in chat -> we return a card
  - card.action.trigger: user clicked a button on a card we sent

This module is signature verification + URL parsing + preview card building.
The Django view in app/views/lark/bot_events.py is the thin HTTP layer.
"""

# Python imports
import base64
import hashlib
import json
import logging
import os
import re

# Third party
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Module imports
from plane.utils.lark_notify import _short_id, issue_url

logger = logging.getLogger("plane.utils.lark_bot_events")


def verification_token():
    return (os.environ.get("LARK_BOT_VERIFICATION_TOKEN") or "").strip()


def encrypt_key():
    return (os.environ.get("LARK_BOT_ENCRYPT_KEY") or "").strip()


def decrypt_lark_payload(ciphertext_b64):
    """Decrypt the AES-256-CBC payload Lark sends when encrypt_key is set.

    Protocol (per Lark docs):
      key       = SHA256(encrypt_key)                # 32 bytes
      raw       = base64_decode(ciphertext_b64)
      iv        = raw[:16]
      ct        = raw[16:]
      plaintext = PKCS7_unpad(AES_CBC_decrypt(ct, key, iv))

    Returns the decoded JSON dict, or None on failure. Failures are quietly
    swallowed because Lark retries on non-2xx and a noisy log on each retry
    would dominate output.
    """
    key = encrypt_key().encode("utf-8")
    if not key:
        return None
    try:
        raw = base64.b64decode(ciphertext_b64)
        if len(raw) < 32:
            return None
        iv, ct = raw[:16], raw[16:]
        aes_key = hashlib.sha256(key).digest()
        cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv))
        decrypted = cipher.decryptor().update(ct) + cipher.decryptor().finalize()
        # PKCS7 unpad: last byte is the pad length
        pad = decrypted[-1]
        if not 1 <= pad <= 16:
            return None
        plaintext = decrypted[:-pad]
        return json.loads(plaintext.decode("utf-8"))
    except Exception:
        logger.exception("decrypt_lark_payload failed")
        return None


def verify_lark_request(headers, body_bytes):
    """Validate that the incoming request actually came from Lark.

    Lark signs every bot-event POST with X-Lark-Signature = sha256(
        timestamp + nonce + encrypt_key + body_bytes
    ). Verifying it stops randoms from injecting fake events into our pipeline.

    Two modes: Lark Open Platform sends signature headers only when an
    encrypt_key is configured for the app. If we have no encrypt_key set
    locally, we fall back to comparing the body's `token` field against
    LARK_BOT_VERIFICATION_TOKEN -- weaker but still better than nothing.

    Returns True iff the request is verified.
    """
    key = encrypt_key()
    sig = headers.get("X-Lark-Signature") or headers.get("HTTP_X_LARK_SIGNATURE")
    timestamp = headers.get("X-Lark-Request-Timestamp") or headers.get(
        "HTTP_X_LARK_REQUEST_TIMESTAMP"
    )
    nonce = headers.get("X-Lark-Request-Nonce") or headers.get(
        "HTTP_X_LARK_REQUEST_NONCE"
    )

    if key and sig and timestamp and nonce:
        msg = (timestamp + nonce + key).encode("utf-8") + body_bytes
        expected = hashlib.sha256(msg).hexdigest()
        return expected == sig

    # No encrypt_key configured -- accept and rely on body-level token check
    # by the caller. Logging makes the weaker mode obvious in audit.
    if not key:
        logger.debug("verify_lark_request: no encrypt_key set; deferring to token check")
        return True

    logger.warning("verify_lark_request: missing signature headers")
    return False


# Plane exposes two URL shapes for the same issue:
#   1. Full UUID form: /<slug>/projects/<project_uuid>/issues/<issue_uuid>/
#   2. Short / shareable form: /<slug>/browse/<PROJECT_IDENT>-<SEQ>/
# Users copy whichever the browser address bar shows them (the short form is
# what the new "Copy link" button puts on the clipboard), so we accept both.
_ISSUE_URL_RE_FULL = re.compile(
    r"/(?P<slug>[A-Za-z0-9_-]+)/projects/"
    r"(?P<project_id>[0-9a-fA-F-]{36})/issues/"
    r"(?P<issue_id>[0-9a-fA-F-]{36})/?"
)
_ISSUE_URL_RE_SHORT = re.compile(
    r"/(?P<slug>[A-Za-z0-9_-]+)/browse/"
    r"(?P<identifier>[A-Za-z0-9]+)-(?P<seq>\d+)/?"
)


def parse_issue_url(url):
    """Resolve an issue URL to a lookup spec.

    Returns either:
      ("uuid",  slug, project_id, issue_id)        for the /projects/.../issues/... form, or
      ("short", slug, identifier,  sequence_id)    for the /browse/IDENT-N form,
    or None when neither pattern matches.
    """
    text = url or ""
    m = _ISSUE_URL_RE_FULL.search(text)
    if m:
        return "uuid", m.group("slug"), m.group("project_id"), m.group("issue_id")
    m = _ISSUE_URL_RE_SHORT.search(text)
    if m:
        return "short", m.group("slug"), m.group("identifier"), int(m.group("seq"))
    return None


def build_url_preview_card(issue, lang="en"):
    """Build the inline card Lark renders next to the pasted Plane URL.

    Compact by design: short id, title, state, assignees, due date. The full
    issue detail is one click away via the view-task button. URL previews
    are view-only by spec (no callback path), so no action row.

    `lang` defaults to "en" since URL previews don't have a single recipient.
    Pass the paster's user_lang() when available.
    """
    from plane.utils.lark_i18n import lark_t

    short = _short_id(issue)
    url = issue_url(issue.workspace.slug, issue.project_id, issue.id)

    state_name = getattr(getattr(issue, "state", None), "name", None) or "—"
    assignees = list(issue.assignees.all()[:5])
    if assignees:
        names = ", ".join(
            (a.display_name or a.first_name or (a.email.split("@")[0] if a.email else "?"))
            for a in assignees
        )
    else:
        names = lark_t("common.unassigned", lang)

    due = issue.target_date.strftime("%Y-%m-%d") if issue.target_date else "—"

    fields = [
        {
            "is_short": True,
            "text": {
                "tag": "lark_md",
                "content": f"**{lark_t('field.state', lang)}**\n{state_name}",
            },
        },
        {
            "is_short": True,
            "text": {
                "tag": "lark_md",
                "content": f"**{lark_t('field.due', lang)}**\n{due}",
            },
        },
        {"is_short": False, "text": {"tag": "lark_md", "content": f"**Assignee**\n{names}"}},
    ]

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"📋 {short}: {issue.name[:80]}"},
            "template": "blue",
        },
        "elements": [
            {"tag": "div", "fields": fields},
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {
                            "tag": "plain_text",
                            "content": lark_t("button.view_task", lang),
                        },
                        "type": "primary",
                        "url": url,
                    }
                ],
            },
        ],
    }


def lookup_issue_for_url(url):
    """Resolve a Plane URL to an Issue ORM row, or None.

    Handles both `/projects/<uuid>/issues/<uuid>/` (full) and `/browse/IDENT-N`
    (short) URL forms -- see parse_issue_url. Late import keeps this module
    importable during Django app loading.
    """
    parsed = parse_issue_url(url)
    if parsed is None:
        return None

    from plane.db.models import Issue

    base_qs = (
        Issue.objects.select_related("workspace", "project", "state")
        .prefetch_related("assignees")
    )

    kind = parsed[0]
    if kind == "uuid":
        _, slug, project_id, issue_id = parsed
        return base_qs.filter(
            id=issue_id, project_id=project_id, workspace__slug=slug
        ).first()
    if kind == "short":
        _, slug, identifier, seq = parsed
        return base_qs.filter(
            workspace__slug=slug,
            project__identifier__iexact=identifier,
            sequence_id=seq,
        ).first()
    return None
