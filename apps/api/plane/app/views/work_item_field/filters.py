# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Isolated, unit-testable helpers for custom-field filter (§8) and sort
(§9) on the issue list. The issue-list views apply these via:

    qs = qs.filter(build_custom_field_filter(request.query_params))
    qs, cf_param = apply_custom_field_order(qs, order_by_param)
    if cf_param is not None: order_by_param = cf_param
    else: qs, order_by_param = order_issue_queryset(qs, order_by_param)

NOTE: ``parse_custom_field_order_by`` (kept for the string contract /
unit tests) returns a bare ``field_values__value_*`` path. Applying that
directly with ``.order_by()`` is WRONG on this model: ``field_values``
is a reverse FK, so a bare join both fans rows out and sorts by an
arbitrary field's value. ``apply_custom_field_order`` is the correct
wiring -- it mirrors the labels/assignees ``Min``-annotate branch of
``order_issue_queryset`` but filters the aggregate to the target field.
"""

from django.db.models import Min, Q

from plane.db.models import WorkItemField

# Operator suffix on the value param -> ORM lookup on the value column.
_OP_SUFFIXES = {
    "": "",  # exact
    "__gte": "__gte",
    "__lte": "__lte",
    "__gt": "__gt",
    "__lt": "__lt",
    "__contains": "__icontains",
}

# Which value column a field_type filters/sorts on (mirrors serializer §3).
_COLUMN_BY_TYPE = {
    WorkItemField.FieldType.TEXT: "value_text",
    WorkItemField.FieldType.NUMBER: "value_number",
    WorkItemField.FieldType.DATE: "value_date",
    WorkItemField.FieldType.SINGLE_SELECT: "value_text",
    WorkItemField.FieldType.MULTI_SELECT: "value_multi",
    WorkItemField.FieldType.PEOPLE: "value_multi",
}

_ORDER_BY_PREFIX = "custom_field__"


def build_custom_field_filter(query_params) -> Q:
    """Translate ``field_values__field_id=<uuid>`` plus one
    ``field_values__<value_col>[__op]=<v>`` pair into an ORM Q against the
    related ``field_values``. Returns an empty Q() when absent (no-op)."""
    field_id = query_params.get("field_values__field_id")
    if not field_id:
        return Q()

    predicate = Q(field_values__field_id=field_id)

    for key in query_params:
        if not key.startswith("field_values__value_"):
            continue
        # split column vs operator suffix
        col_and_op = key[len("field_values__") :]
        matched_suffix = ""
        for suffix in _OP_SUFFIXES:
            if suffix and col_and_op.endswith(suffix):
                matched_suffix = suffix
                break
        column = col_and_op[: len(col_and_op) - len(matched_suffix)] if matched_suffix else col_and_op
        lookup = _OP_SUFFIXES.get(matched_suffix, "")
        orm_key = f"field_values__{column}{lookup}"
        predicate &= Q(**{orm_key: query_params.get(key)})

    return predicate


def parse_custom_field_order_by(order_by_param):
    """Map ``?order_by=custom_field__<field_id>`` (optionally ``-`` prefixed
    for desc) to the right ``field_values__value_*`` ordering. Returns a
    list of order_by args, or None if the param is not a custom-field sort.

    Depends on PR2's 24-option sort menu landing first (design §9/§10
    step 10) for the UI side; this server parser is ready regardless."""
    if not order_by_param:
        return None

    desc = order_by_param.startswith("-")
    raw = order_by_param[1:] if desc else order_by_param
    if not raw.startswith(_ORDER_BY_PREFIX):
        return None

    field_id = raw[len(_ORDER_BY_PREFIX) :]
    field = WorkItemField.objects.filter(pk=field_id).first()
    if field is None:
        return None

    column = _COLUMN_BY_TYPE.get(field.field_type, "value_text")
    key = f"field_values__{column}"
    return [f"-{key}" if desc else key]


def apply_custom_field_order(issue_queryset, order_by_param):
    """Order an issue queryset by a custom field's value.

    ``?order_by=custom_field__<field_id>`` (optionally ``-`` for desc).
    Mirrors the labels/assignees ``Min``-annotate branch of
    ``order_issue_queryset``, but the aggregate is filtered to the
    target ``field_id`` so the reverse-FK ``field_values`` join cannot
    fan rows out or sort by an unrelated field's value. The
    ``order_by_param`` is rewritten to the annotation name (exactly as
    the built-in helper rewrites to ``min_values``/``max_values``) so
    the downstream grouper/paginator keep working unchanged.

    Returns ``(queryset, rewritten_order_by_param)`` when it handled a
    custom-field sort, else ``(queryset, None)`` so the caller falls
    back to ``order_issue_queryset``.

    Note: number/date/text sort meaningfully; single_select sorts on the
    option UUID (value_text) and multi_select/people on the value_multi
    array -- mechanically applied but not semantically ordered by label.
    """
    if not order_by_param:
        return issue_queryset, None

    desc = order_by_param.startswith("-")
    raw = order_by_param[1:] if desc else order_by_param
    if not raw.startswith(_ORDER_BY_PREFIX):
        return issue_queryset, None

    field_id = raw[len(_ORDER_BY_PREFIX) :]
    field = WorkItemField.objects.filter(pk=field_id).first()
    if field is None:
        return issue_queryset, None

    column = _COLUMN_BY_TYPE.get(field.field_type, "value_text")
    issue_queryset = issue_queryset.annotate(
        custom_field_order=Min(
            f"field_values__{column}",
            filter=Q(field_values__field_id=field_id),
        )
    ).order_by(
        "-custom_field_order" if desc else "custom_field_order",
        "-created_at",
    )
    return issue_queryset, ("-custom_field_order" if desc else "custom_field_order")
