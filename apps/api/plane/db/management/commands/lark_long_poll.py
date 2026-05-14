# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Long-poll worker that keeps an outbound WebSocket open to Lark.

The standard inbound-webhook path (`/auth/lark/bot/event/`) fails when the
deploy isn't reachable from China within Lark's 3-second verification window
-- which it isn't for our New Jersey droplet. Lark publishes an SDK that
flips the polarity: our worker dials *out* to Lark and receives events on
the same long-lived connection. Bypasses GFW + trans-Pacific RTT entirely.

Run as: `python manage.py lark_long_poll`
Container: see apps/api/bin/docker-entrypoint-lark-poll.sh
"""

# Python imports
import logging
import os
import signal
import sys

# Django
from django.core.management.base import BaseCommand

logger = logging.getLogger("plane.management.lark_long_poll")


class Command(BaseCommand):
    help = "Run the Lark long-poll event worker (URL preview, card actions)."

    def handle(self, *args, **options):
        # SDK dispatches event handlers from inside its asyncio loop, but our
        # Issue lookup is a vanilla Django ORM call. Django blocks sync ORM in
        # async contexts by default; opt out since our queries are tiny PK
        # lookups (<50ms) and never block the loop meaningfully.
        os.environ.setdefault("DJANGO_ALLOW_ASYNC_UNSAFE", "1")

        app_id = (os.environ.get("LARK_CLIENT_ID") or "").strip()
        app_secret = (os.environ.get("LARK_CLIENT_SECRET") or "").strip()
        if not (app_id and app_secret):
            self.stderr.write("LARK_CLIENT_ID / LARK_CLIENT_SECRET not set; exiting.")
            sys.exit(1)

        # Lark's SDK isn't a hard dependency for the rest of Plane, so import
        # late and surface a clear error if the image was built without it.
        try:
            import lark_oapi as lark
        except ImportError as exc:
            self.stderr.write(f"lark-oapi not installed: {exc}")
            sys.exit(1)

        from plane.utils.lark_bot_events import (
            build_url_preview_card,
            lookup_issue_for_url,
        )

        domain_env = (os.environ.get("LARK_BASE_DOMAIN") or "feishu.cn").strip()
        # SDK exposes the regional Open Platform URL as a string constant per
        # tenant region. Pick the one that matches LARK_BASE_DOMAIN so we
        # stay on the same region as the IM-send / OAuth flows.
        domain = lark.LARK_DOMAIN if "larksuite" in domain_env else lark.FEISHU_DOMAIN

        from plane.utils.lark_notify import _short_id

        def _on_url_preview(data):
            """Build the inline link preview for a pasted Plane URL.

            Response shape per Lark docs:
              { "inline": { "i18n_title": { "zh_cn": "..." } }, "card": {...} }

            - `inline` is required and renders as a one-line preview chip.
            - `card` is OPTIONAL and requires a pre-built template (template_id
              from Card Builder) -- raw interactive-card JSON is rejected.
              We skip card for now and ship a rich inline title; card support
              is the obvious next iteration once we build the template.
            - `preview_token` is NOT echoed back (the SDK correlates events
              by message id internally).
            """
            url = None
            try:
                ctx = getattr(data.event, "context", None)
                if ctx is not None:
                    url = getattr(ctx, "url", None)
                if url is None:
                    url = getattr(data.event, "url", None)
            except Exception:
                logger.exception("Failed to read url from event")

            if not url:
                return {}

            try:
                issue = lookup_issue_for_url(url)
            except Exception:
                logger.exception("Issue lookup failed for %s", url)
                issue = None

            if issue is None:
                return {}

            short = _short_id(issue)
            state = getattr(getattr(issue, "state", None), "name", None) or "—"
            due = issue.target_date.strftime("%Y-%m-%d") if issue.target_date else "无"
            # Inline previews are one-liners; cram the high-signal fields into
            # the title since this is the only text the user sees inline.
            title = f"📋 {short} · {issue.name[:60]} · {state} · 截止 {due}"

            return {
                "inline": {
                    "i18n_title": {
                        "zh_cn": title,
                        "en_us": title,
                    }
                }
            }

        def _on_card_action(data):
            """Handle button clicks on DM cards we sent.

            Action payload shape -- card builder packs short keys:
              {"a": "done", "i": "<issue_uuid>"}
            Operator info comes via data.event.operator.open_id; we look up
            the Plane User via the Account.provider_account_id index (Lark's
            union_id matches the provider_account_id we stored at SSO time).

            Response shape per Lark docs accepts {"toast": {...}, "card": {...}}.
            For v1 we just toast success/failure; updating the card with the
            new state is a follow-up.
            """
            from plane.db.models import Account, Issue, State

            try:
                action = getattr(data.event, "action", None)
                value = getattr(action, "value", None) if action else None
                if value is None:
                    return {}
                # SDK gives us a dict-like; tolerate both attribute and key access.
                act = value.get("a") if hasattr(value, "get") else getattr(value, "a", None)
                issue_id = value.get("i") if hasattr(value, "get") else getattr(value, "i", None)

                if act != "done" or not issue_id:
                    return {}

                # Identify the clicker so audit (updated_by) reflects them.
                operator = getattr(data.event, "operator", None)
                actor_user = None
                if operator is not None:
                    union_id = getattr(operator, "union_id", None) or getattr(operator, "open_id", None)
                    if union_id:
                        acct = Account.objects.filter(
                            provider="lark", provider_account_id=union_id
                        ).select_related("user").first()
                        if acct:
                            actor_user = acct.user

                issue = (
                    Issue.objects.select_related("project", "state")
                    .filter(id=issue_id)
                    .first()
                )
                if issue is None:
                    return {"toast": {"type": "error", "content": "任务不存在"}}

                # Pick the project's first 'completed' group state. Plane's
                # State.group enum: backlog/unstarted/started/completed/cancelled.
                done_state = (
                    State.objects.filter(project_id=issue.project_id, group="completed")
                    .order_by("sequence")
                    .first()
                )
                if done_state is None:
                    return {"toast": {"type": "error", "content": "项目里没有完成态"}}

                if issue.state_id == done_state.id:
                    return {"toast": {"type": "info", "content": "已经是完成状态"}}

                issue.state_id = done_state.id
                if actor_user is not None:
                    issue.updated_by_id = actor_user.id
                issue.save(update_fields=["state_id", "updated_by_id", "updated_at"])

                return {"toast": {"type": "success", "content": f"✅ 已标记为「{done_state.name}」"}}
            except Exception:
                logger.exception("card.action.trigger handler failed")
                return {"toast": {"type": "error", "content": "操作失败,请稍后重试"}}

        handler = (
            lark.EventDispatcherHandler.builder("", "")
            .register_p2_url_preview_get(_on_url_preview)
            .register_p2_card_action_trigger(_on_card_action)
            .build()
        )

        client = lark.ws.Client(
            app_id,
            app_secret,
            log_level=lark.LogLevel.INFO,
            event_handler=handler,
            domain=domain,
        )

        def _graceful_shutdown(signum, _frame):
            logger.info("Received signal %s; stopping Lark long-poll worker", signum)
            sys.exit(0)

        signal.signal(signal.SIGTERM, _graceful_shutdown)
        signal.signal(signal.SIGINT, _graceful_shutdown)

        self.stdout.write(f"Lark long-poll worker connecting (domain={domain_env})...")
        client.start()  # blocks until SIGTERM / fatal error
