# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hourly Celery beat task: DM assignees about approaching/past due-dates.

Three reminder stages, each capped at one DM per assignee per stage per day
(deduped via a durable LarkDueReminderLog row — atomic across beat workers
and surviving cache loss/restart) so the hourly cadence doesn't spam:
  - soon    (24h-48h before target_date) -> orange card "⏰ 任务明天到期"
  - today   (target_date == today, UTC)  -> red card    "🔥 任务今日到期"
  - overdue (target_date in the past,
             within OVERDUE_WINDOW_DAYS)   -> red card    "❗ 任务已逾期 N 天"

After OVERDUE_WINDOW_DAYS the issue is presumed handled / abandoned and we
stop nagging. Skips issues whose state is in the completed or cancelled
group -- no point reminding about done work.

Whole task is a no-op unless LARK_NOTIFICATIONS_ENABLED is truthy.
"""

# Python imports
import logging
import os
from datetime import date, timedelta

# Third party
from celery import shared_task

# Django
from django.utils import timezone

logger = logging.getLogger("plane.bgtasks.lark_due_reminder_task")

# Don't keep nagging forever -- if a task is 8+ days overdue, the team has
# already decided to ignore it; further DMs are pure noise.
OVERDUE_WINDOW_DAYS = 7


def _notifications_enabled():
    return (os.environ.get("LARK_NOTIFICATIONS_ENABLED") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


@shared_task
def remind_due_dates_task():
    """Scan upcoming/overdue issues and DM their assignees once per stage/day."""
    if not _notifications_enabled():
        return {"skipped": "LARK_NOTIFICATIONS_ENABLED not set"}

    # Late import keeps Celery's task discovery cheap at boot.
    from plane.db.models import Issue, LarkDueReminderLog
    from plane.utils.lark_notify import (
        card_issue_due_reminder,
        get_union_id,
        send_interactive_card,
    )
    from plane.utils.lark_i18n import user_lang

    today = date.today()
    tomorrow = today + timedelta(days=1)
    earliest_overdue = today - timedelta(days=OVERDUE_WINDOW_DAYS)

    # Build the candidate set in one query. Excluding completed/cancelled
    # group states up front saves us per-row checks later.
    candidates = list(
        Issue.objects.select_related("workspace", "project", "state")
        .prefetch_related("assignees")
        .filter(
            target_date__gte=earliest_overdue,
            target_date__lte=tomorrow,
        )
        .exclude(state__group__in=("completed", "cancelled"))
    )

    sent = skipped_dup = no_union = errored = 0

    for issue in candidates:
        # Classify the stage; days = signed delta from today (negative => overdue).
        delta = (issue.target_date - today).days
        if delta < 0:
            stage = "overdue"
        elif delta == 0:
            stage = "today"
        elif delta == 1:
            stage = "soon"
        else:
            continue  # outside the windows we care about (shouldn't hit -- query bounds us)

        for assignee in issue.assignees.all():
            # Atomic durable claim. The unique (issue, receiver, stage,
            # reminder_date) constraint makes this idempotent across the
            # hourly cadence AND across concurrent beat workers, regardless
            # of whether the cache is healthy. The claim is released on any
            # failure below so a later run retries -- i.e. the
            # once-per-stage/day slot is only consumed on a confirmed
            # successful send (same intent the old Redis check had, now
            # durable). Release uses a hard delete (soft=False): a failed
            # claim has no audit value, and a soft delete would both leave
            # a ghost row and queue a pointless cascade task per failure.
            _log, created = LarkDueReminderLog.objects.get_or_create(
                issue=issue,
                receiver=assignee,
                stage=stage,
                reminder_date=today,
            )
            if not created:
                skipped_dup += 1
                continue

            # Build the card per-recipient so each assignee sees their own
            # language. The dict construction is cheap; we'd otherwise have
            # to cache N cards keyed by language, which isn't worth it.
            try:
                card = card_issue_due_reminder(issue, stage, delta, lang=user_lang(assignee))
            except Exception:
                logger.exception("Failed to build due-reminder card for issue=%s", issue.id)
                _log.delete(soft=False)
                errored += 1
                continue

            try:
                union_id = get_union_id(assignee)
            except Exception:
                logger.exception("get_union_id failed for assignee=%s", assignee.id)
                _log.delete(soft=False)
                errored += 1
                continue

            if not union_id:
                _log.delete(soft=False)
                no_union += 1
                continue

            try:
                ok = send_interactive_card(union_id, card)
            except Exception:
                logger.exception(
                    "send_interactive_card failed: issue=%s assignee=%s", issue.id, assignee.id
                )
                _log.delete(soft=False)
                errored += 1
                continue

            if ok:
                _log.sent_at = timezone.now()
                _log.save(update_fields=["sent_at"])
                sent += 1
            else:
                _log.delete(soft=False)
                errored += 1

    stats = {
        "sent": sent,
        "skipped_dup": skipped_dup,
        "no_union": no_union,
        "errored": errored,
        "candidates": len(candidates),
    }
    logger.info("lark due-date reminder run: %s", stats)
    return stats
