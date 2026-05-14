"""Lark/Feishu H5 JSSDK signature helpers.

Lark webapp pages embedded via the H5 SDK must call `h5sdk.config()` with
a server-issued signature before any JSAPI (e.g. `tt.getBlockActionSourceDetail`,
`tt.getTriggerContext`) will resolve. This module mints those signatures.

Spec (verified against open.feishu.cn 2026-05-14):
- jsapi_ticket endpoint: POST /open-apis/jssdk/ticket/get with
  `Authorization: Bearer <tenant_access_token>`. Response has
  `{data: {ticket, expire_in}}`; TTL is typically 7200s. Cache slightly
  under to avoid races.
- Signature: SHA1 over the concatenation
  `jsapi_ticket={t}&noncestr={n}&timestamp={ts}&url={u}` -- order is
  fixed (NOT alphabetical), keys lowercase, values raw (no URL encoding).
- URL: full page URL including query string, hash fragment stripped.
- Timestamp: Unix seconds (string).
"""

import hashlib
import logging
import os
import secrets
import time

import requests
from django.core.cache import cache

from plane.utils.lark_notify import _base_host, _get_tenant_token

logger = logging.getLogger("plane.utils.lark_jssdk")

_TICKET_CACHE_KEY = "lark:jsapi_ticket"
_TICKET_CACHE_TTL = 6600  # 110 min; Lark issues 7200s tickets, refresh well before
_NONCE_BYTES = 12


def _strip_fragment(url):
    return url.split("#", 1)[0]


def _get_jsapi_ticket():
    cached = cache.get(_TICKET_CACHE_KEY)
    if cached:
        return cached

    token = _get_tenant_token()
    if not token:
        return None

    try:
        resp = requests.post(
            f"{_base_host()}/open-apis/jssdk/ticket/get",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            json={},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
    except requests.RequestException as exc:
        logger.warning("Lark jsapi_ticket fetch failed: %s", exc)
        return None

    if body.get("code", 0) != 0:
        logger.warning("Lark jsapi_ticket non-zero code: %s", body)
        return None

    data = body.get("data") or {}
    ticket = data.get("ticket")
    if ticket:
        ttl = min(int(data.get("expire_in") or _TICKET_CACHE_TTL), _TICKET_CACHE_TTL)
        cache.set(_TICKET_CACHE_KEY, ticket, ttl)
    return ticket


def build_h5_config(url):
    """Mint a signed h5sdk.config payload for the given page URL.

    Returns None when Lark credentials are unset or the upstream call fails;
    the caller should surface a 503 in that case so the frontend can retry.
    """
    app_id = (os.environ.get("LARK_CLIENT_ID") or "").strip()
    if not app_id:
        return None

    ticket = _get_jsapi_ticket()
    if not ticket:
        return None

    nonce = secrets.token_hex(_NONCE_BYTES)
    # Lark's H5 SDK interprets the timestamp as milliseconds, not seconds.
    # Sending Unix seconds triggers errno 2601002 "signature is expired"
    # because Lark reads e.g. 1.78e9 as 1970-08-21. Both the signature
    # input string and the payload field must use milliseconds.
    timestamp_ms = int(time.time() * 1000)
    page_url = _strip_fragment(url)

    raw = (
        f"jsapi_ticket={ticket}"
        f"&noncestr={nonce}"
        f"&timestamp={timestamp_ms}"
        f"&url={page_url}"
    )
    signature = hashlib.sha1(raw.encode("utf-8")).hexdigest()

    return {
        "appId": app_id,
        "timestamp": timestamp_ms,
        "nonceStr": nonce,
        "signature": signature,
    }
