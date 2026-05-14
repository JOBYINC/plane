"""Lark notification i18n.

Card builders and URL preview text used to be hardcoded zh-CN. Plane stores
each user's UI language preference at `User.language` (default "en"). This
module looks up that language and returns the matching string so a user
who set their Plane UI to English sees English Bot DMs, not Chinese.

Languages currently translated end-to-end:
- en  (default fallback for unrecognized codes)
- zh-CN

Adding a new language: copy any `LARK_I18N["en"]` block, translate values,
add under the new key. All keys must exist for every language; lookup
falls back to "en" key-by-key, then to the literal key string if absent.

Lookup key convention: `<surface>.<context>.<role>`
  card.issue_assigned.header     -> the orange/red bar text at the top
  card.issue_assigned.field_task -> the **Task** field label
  card.due.overdue.header        -> "Task overdue by N days"
"""

LARK_I18N = {
    "en": {
        "common.system": "System",
        "common.unknown": "unknown",
        "common.someone": "Someone",
        "common.unassigned": "Unassigned",

        "button.complete": "✅ Done",
        "button.view_task": "View task →",

        "field.task": "Task",
        "field.title": "Title",
        "field.assigner": "Assigner",
        "field.state": "State",
        "field.due": "Due",

        "card.issue_assigned.header": "📋 You've been assigned a new task",

        "card.issue_state_changed.header": "🔄 Task state changed",
        "card.issue_state_changed.line": "**{old}** → **{new}** _by {who}_",

        "card.due.soon.header": "⏰ Task due tomorrow",
        "card.due.soon.timing": "Due: **{due}** (tomorrow)",
        "card.due.today.header": "🔥 Task due today",
        "card.due.today.timing": "Due: **{due}** (today)",
        "card.due.overdue.header": "❗ Task overdue by {days} day(s)",
        "card.due.overdue.timing": "Originally due: **{due}** (overdue)",

        "card.issue_completed.header": "✅ Task completed",
        "card.issue_completed.line": "Marked as **{state}** by **{completer}**",

        "card.issue_comment.header": "💬 New comment on task",
        "card.issue_comment.line": "**{commenter}**: {excerpt}",

        "url_preview.due_label": "Due",
        "url_preview.due_unset": "—",

        "toast.marked_done": "✅ Marked as «{state}»",
        "toast.issue_not_found": "Task not found",
        "toast.no_completed_state": "No 'completed' state configured for this project",
        "toast.already_done": "Already in a completed state",
        "toast.action_failed": "Action failed, please retry shortly",

        "url_preview.title": "📋 {short} · {name} · {state} · {due_label} {due}",
        "url_preview.due_unset_long": "no due date",
    },
    "zh-CN": {
        "common.system": "系统",
        "common.unknown": "未知",
        "common.someone": "某人",
        "common.unassigned": "未分配",

        "button.complete": "✅ 完成",
        "button.view_task": "查看任务 →",

        "field.task": "任务",
        "field.title": "标题",
        "field.assigner": "分配人",
        "field.state": "状态",
        "field.due": "截止",

        "card.issue_assigned.header": "📋 你被分配了新任务",

        "card.issue_state_changed.header": "🔄 任务状态变更",
        "card.issue_state_changed.line": "**{old}** → **{new}** _由 {who}_",

        "card.due.soon.header": "⏰ 任务明天到期",
        "card.due.soon.timing": "截止: **{due}** (明天)",
        "card.due.today.header": "🔥 任务今日到期",
        "card.due.today.timing": "截止: **{due}** (今天)",
        "card.due.overdue.header": "❗ 任务已逾期 {days} 天",
        "card.due.overdue.timing": "原定截止: **{due}** (已过期)",

        "card.issue_completed.header": "✅ 任务已完成",
        "card.issue_completed.line": "已由 **{completer}** 标记为 **{state}**",

        "card.issue_comment.header": "💬 任务有新评论",
        "card.issue_comment.line": "**{commenter}**: {excerpt}",

        "url_preview.due_label": "截止",
        "url_preview.due_unset": "—",

        "toast.marked_done": "✅ 已标记为「{state}」",
        "toast.issue_not_found": "任务不存在",
        "toast.no_completed_state": "项目里没有完成态",
        "toast.already_done": "已经是完成状态",
        "toast.action_failed": "操作失败,请稍后重试",

        "url_preview.title": "📋 {short} · {name} · {state} · {due_label} {due}",
        "url_preview.due_unset_long": "无截止",
    },
}

DEFAULT_LANG = "en"
_KNOWN_LANGS = set(LARK_I18N.keys())


def normalize_lang(lang):
    """Normalize a User.language value to a key we have translations for.

    Plane stores raw values like 'en', 'zh-CN', 'fr', 'ja'. We currently
    have full Lark coverage only for en + zh-CN; everything else falls
    back to en. Two-letter prefixes also match (zh -> zh-CN, en-US -> en).
    """
    if not lang:
        return DEFAULT_LANG
    lang = lang.strip()
    if lang in _KNOWN_LANGS:
        return lang
    short = lang.split("-", 1)[0].lower()
    if short == "zh":
        return "zh-CN"
    if short == "en":
        return "en"
    return DEFAULT_LANG


def lark_t(key, lang, **fmt):
    """Translate `key` into the user's language and optionally format.

    Returns the literal `key` string if the key is missing from both the
    user's language dict and the en fallback (loud-but-not-broken).
    """
    norm = normalize_lang(lang)
    raw = LARK_I18N.get(norm, {}).get(key)
    if raw is None and norm != DEFAULT_LANG:
        raw = LARK_I18N.get(DEFAULT_LANG, {}).get(key)
    if raw is None:
        return key  # surface missing keys instead of silently dropping
    if fmt:
        try:
            return raw.format(**fmt)
        except (KeyError, IndexError):
            return raw
    return raw


def user_lang(user):
    """Pull a user's language preference, with safe fallback."""
    if user is None:
        return DEFAULT_LANG
    return normalize_lang(getattr(user, "language", None))
