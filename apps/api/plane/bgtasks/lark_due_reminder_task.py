# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hourly Celery beat task: DM assignees once about an approaching due-date.

Exactly one DM per (issue, assignee), fired the day `target_date - today == 3`:

  - upcoming (3 days before target_date) -> yellow card "🗓️ 任务还有 3 天到期"

Once a LarkDueReminderLog row exists for (issue, receiver) we never DM that
pair again — moving the due date forward and back does not re-trigger, and
overdue / day-of / day-before reminders are intentionally not sent.

Tasks whose lead time at creation is already < 4 days are skipped entirely:
if you create a task due in 1-3 days, the act of creating it IS the reminder.
Same for tasks created with a past due date.

Skips issues whose state is in the completed or cancelled group.
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

# Single firing point: how many days before target_date we DM.
LEAD_DAYS = 3
# Identifier persisted in LarkDueReminderLog.stage; lets the (issue, receiver)
# dedup query still work against historical "soon"/"today"/"overdue" rows
# without needing a data migration.
STAGE = "due_in_3"


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
    target = today + timedelta(days=LEAD_DAYS)

    # Build the candidate set in one query. Excluding completed/cancelled
    # group states up front saves us per-row checks later. Template
    # projects are blueprints — their issues exist to be cloned, not
    # worked, so they must never trigger due-date DMs.
    candidates = list(
        Issue.objects.select_related("workspace", "project", "state")
        .prefetch_related("assignees")
        .filter(
            target_date=target,
            project__is_template=False,
        )
        .exclude(state__group__in=("completed", "cancelled"))
    )

    sent = skipped_dup = skipped_short_lead = no_union = errored = 0

    for issue in candidates:
        # Skip tasks whose lead time at creation was already too short. If you
        # create a task due in 1-3 days, the act of creating it IS the reminder.
        # Compare on the same date scale as target_date (DateField, naive day).
        created_date = issue.created_at.date() if issue.created_at else today
        if (issue.target_date - created_date).days < LEAD_DAYS + 1:
            skipped_short_lead += 1
            continue

        for assignee in issue.assignees.all():
            # "Once per (issue, receiver) ever" — if any prior log row exists
            # for this pair (regardless of stage / reminder_date), we already
            # DMed them about this issue and never DM again. This survives the
            # user moving the due date forward and back across the 3-day mark.
            if LarkDueReminderLog.objects.filter(
                issue=issue, receiver=assignee, deleted_at__isnull=True
            ).exists():
                skipped_dup += 1
                continue

            # Atomic durable claim. The partial unique
            # (issue, receiver, stage, reminder_date) constraint makes this
            # idempotent across the hourly cadence AND across concurrent beat
            # workers (the pre-check above might race; the constraint is the
            # actual guarantee). On any failure below the claim is released so
            # a later run can retry; release is a hard delete (soft=False) —
            # a failed claim has no audit value and a soft delete would both
            # leave a ghost row and queue a pointless cascade task per failure.
            #
            # Accepted race (under-DM): if a send fails on the LAST hourly
            # tick before UTC midnight, the released claim won't be re-tried
            # the next day because target_date is now today+2 and falls
            # outside the target_date == today+3 filter. The reminder is lost
            # for this assignee. Hourly cadence with 24 attempts/day makes
            # this a corner case (would require an outage spanning the very
            # last tick), and the once-per-task semantic is more important
            # than guaranteed delivery — the user explicitly traded one for
            # the other.
            _log, created = LarkDueReminderLog.objects.get_or_create(
                issue=issue,
                receiver=assignee,
                stage=STAGE,
                reminder_date=today,
            )
            if not created:
                skipped_dup += 1
                continue

            # Build the card per-recipient so each assignee sees their own
            # language. The dict construction is cheap; we'd otherwise have
            # to cache N cards keyed by language, which isn't worth it.
            try:
                card = card_issue_due_reminder(issue, LEAD_DAYS, lang=user_lang(assignee))
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
        "skipped_short_lead": skipped_short_lead,
        "no_union": no_union,
        "errored": errored,
        "candidates": len(candidates),
    }
    logger.info("lark due-date reminder run: %s", stats)
    return stats
