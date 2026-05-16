# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Lark/Feishu Bot messaging helpers.

Keeps the Bot HTTP integration isolated so signal handlers and Celery
tasks stay readable. Token caching uses the Django cache so we don't
re-mint a tenant_access_token (2-hour TTL) on every notification.
"""

# Python imports
import json
import logging
import os

# Third party
import requests

# Django imports
from django.core.cache import cache

# Local
from plane.utils.lark_i18n import lark_t

logger = logging.getLogger("plane.utils.lark_notify")

_TOKEN_CACHE_KEY = "lark:tenant_token"
_TOKEN_CACHE_TTL = 5400  # 90 min; Lark tokens expire after 2h, refresh well before


def _base_host():
    domain = (os.environ.get("LARK_BASE_DOMAIN") or "feishu.cn").strip()
    return f"https://open.{domain}"


def _get_tenant_token():
    cached = cache.get(_TOKEN_CACHE_KEY)
    if cached:
        return cached

    app_id = (os.environ.get("LARK_CLIENT_ID") or "").strip()
    app_secret = (os.environ.get("LARK_CLIENT_SECRET") or "").strip()
    if not (app_id and app_secret):
        return None

    try:
        resp = requests.post(
            f"{_base_host()}/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
    except requests.RequestException as exc:
        logger.warning("Lark token fetch failed: %s", exc)
        return None

    if body.get("code", 0) != 0:
        logger.warning("Lark token returned non-zero code: %s", body)
        return None

    token = body.get("tenant_access_token")
    if token:
        cache.set(_TOKEN_CACHE_KEY, token, _TOKEN_CACHE_TTL)
    return token


def get_union_id(user):
    """Resolve a Plane user to their Lark union_id.

    Priority:
      1. Account row created by the OAuth provider (provider='lark') —
         provider_account_id is the union_id (see lark.py provider).
      2. Synthetic email parsing for users bulk-imported via the sync
         task but who haven't signed in via Lark yet.
    """
    if user is None:
        return None
    # Late import to avoid app-loading order issues
    from plane.db.models import Account

    try:
        account = Account.objects.filter(user=user, provider="lark").first()
        if account and account.provider_account_id:
            return account.provider_account_id
    except Exception:
        logger.exception("Account lookup failed for user=%s", user.id)

    email = (user.email or "").strip().lower()
    if email.endswith("@lark.local"):
        return email.split("@")[0]
    return None


def _send(union_id, msg_type, content_dict):
    if not union_id:
        return False
    token = _get_tenant_token()
    if not token:
        logger.warning("No Lark tenant_access_token — skipping notify to %s", union_id)
        return False

    try:
        resp = requests.post(
            f"{_base_host()}/open-apis/im/v1/messages",
            params={"receive_id_type": "union_id"},
            headers={"Authorization": f"Bearer {token}"},
            json={
                "receive_id": union_id,
                "msg_type": msg_type,
                "content": json.dumps(content_dict, ensure_ascii=False),
            },
            timeout=10,
        )
        body = resp.json()
    except requests.RequestException as exc:
        logger.warning("Lark IM send failed for %s: %s", union_id, exc)
        return False

    if body.get("code", 0) != 0:
        logger.warning("Lark IM non-zero for %s: %s", union_id, body)
        return False
    return True


def send_text(union_id, text):
    return _send(union_id, "text", {"text": text})


def send_interactive_card(union_id, card):
    """`card` is the full interactive-card JSON dict (header + elements)."""
    return _send(union_id, "interactive", card)


# ---------- Card builders --------------------------------------------------


def _plane_base_url():
    return (os.environ.get("PLANE_PUBLIC_BASE_URL") or "https://task.vijimgroup.com").rstrip("/")


def issue_url(workspace_slug, project_id, issue_id):
    return f"{_plane_base_url()}/{workspace_slug}/projects/{project_id}/issues/{issue_id}/"


def _short_id(issue):
    project_identifier = getattr(issue.project, "identifier", "") if getattr(issue, "project", None) else ""
    return f"{project_identifier}-{issue.sequence_id}" if project_identifier else f"#{issue.sequence_id}"


def _issue_action_row(issue, lang="en"):
    """Standard action row appended to every issue DM card.

    "✅ 完成" / "✅ Done" fires a card.action.trigger callback handled by the
    long-poll worker (sets state -> first 'completed' group state).
    "View task →" is a plain URL button -- no callback needed.

    Button `value` payload uses single-char keys ("a"=action, "i"=issue_id)
    because Lark caps action value size.
    """
    url = issue_url(issue.workspace.slug, issue.project_id, issue.id)
    return {
        "tag": "action",
        "actions": [
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": lark_t("button.complete", lang)},
                "type": "primary",
                "value": {"a": "done", "i": str(issue.id)},
            },
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": lark_t("button.view_task", lang)},
                "type": "default",
                "url": url,
            },
        ],
    }


def card_issue_assigned(issue, assigner_name, lang="en"):
    short = _short_id(issue)
    assigner = assigner_name or lark_t("common.system", lang)
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": lark_t("card.issue_assigned.header", lang)},
            "template": "blue",
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {
                        "is_short": True,
                        "text": {
                            "tag": "lark_md",
                            "content": f"**{lark_t('field.task', lang)}**\n{short}",
                        },
                    },
                    {
                        "is_short": True,
                        "text": {
                            "tag": "lark_md",
                            "content": f"**{lark_t('field.assigner', lang)}**\n{assigner}",
                        },
                    },
                ],
            },
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": f"**{lark_t('field.title', lang)}**\n{issue.name}",
                },
            },
            _issue_action_row(issue, lang),
        ],
    }


def card_issue_state_changed(issue, old_state_name, new_state_name, changer_name, lang="en"):
    short = _short_id(issue)
    who = changer_name or lark_t("common.system", lang)
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {
                "tag": "plain_text",
                "content": lark_t("card.issue_state_changed.header", lang),
            },
            "template": "turquoise",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**{short}**: {issue.name}"}},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": lark_t(
                        "card.issue_state_changed.line",
                        lang,
                        old=old_state_name or "?",
                        new=new_state_name or "?",
                        who=who,
                    ),
                },
            },
            _issue_action_row(issue, lang),
        ],
    }


def card_issue_due_reminder(issue, stage, days, lang="en"):
    """Card sent by the hourly Celery beat job for approaching deadlines.

    `stage` is one of:
      - "soon":    24h-48h before target_date -> orange
      - "today":   target_date == today      -> red
      - "overdue": target_date in the past   -> red

    Reuses the standard action row so the recipient can one-click complete
    from the reminder DM without opening Plane.
    """
    short = _short_id(issue)
    due = issue.target_date.strftime("%Y-%m-%d") if issue.target_date else "—"
    state_name = getattr(getattr(issue, "state", None), "name", None) or "—"

    if stage == "overdue":
        header_title = lark_t("card.due.overdue.header", lang, days=abs(days))
        template = "red"
        timing = lark_t("card.due.overdue.timing", lang, due=due)
    elif stage == "today":
        header_title = lark_t("card.due.today.header", lang)
        template = "red"
        timing = lark_t("card.due.today.timing", lang, due=due)
    else:  # soon
        header_title = lark_t("card.due.soon.header", lang)
        template = "orange"
        timing = lark_t("card.due.soon.timing", lang, due=due)

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": header_title},
            "template": template,
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {
                        "is_short": True,
                        "text": {
                            "tag": "lark_md",
                            "content": f"**{lark_t('field.task', lang)}**\n{short}",
                        },
                    },
                    {
                        "is_short": True,
                        "text": {
                            "tag": "lark_md",
                            "content": f"**{lark_t('field.state', lang)}**\n{state_name}",
                        },
                    },
                ],
            },
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": f"**{lark_t('field.title', lang)}**\n{issue.name}",
                },
            },
            {"tag": "div", "text": {"tag": "lark_md", "content": timing}},
            _issue_action_row(issue, lang),
        ],
    }


def card_issue_completed(issue, completer_name, completed_state_name, lang="en"):
    """Replacement card returned after the user clicks ✅ Done.

    Lark replaces the original card with this one when we return it under
    `card` in the action callback response, so the Done button visually
    disappears and can't be clicked twice.
    """
    short = _short_id(issue)
    url = issue_url(issue.workspace.slug, issue.project_id, issue.id)
    completer = completer_name or lark_t("common.unknown", lang)
    state = completed_state_name or "Done"
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": lark_t("card.issue_completed.header", lang)},
            "template": "green",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**{short}**: {issue.name}"}},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": lark_t(
                        "card.issue_completed.line",
                        lang,
                        completer=completer,
                        state=state,
                    ),
                },
            },
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": lark_t("button.view_task", lang)},
                        "type": "default",
                        "url": url,
                    }
                ],
            },
        ],
    }


def card_issue_comment(issue, comment_excerpt, commenter_name, lang="en"):
    short = _short_id(issue)
    commenter = commenter_name or lark_t("common.someone", lang)
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": lark_t("card.issue_comment.header", lang)},
            "template": "green",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**{short}**: {issue.name}"}},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": lark_t(
                        "card.issue_comment.line",
                        lang,
                        commenter=commenter,
                        excerpt=comment_excerpt,
                    ),
                },
            },
            _issue_action_row(issue, lang),
        ],
    }
