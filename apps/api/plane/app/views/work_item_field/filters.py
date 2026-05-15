# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Isolated, unit-testable helpers for custom-field filter (§8) and sort
(§9) on the issue list. Deliberately NOT wired into the issue-list hot
path here -- that wiring is a gated edit (see design §7 rationale): a
wrong predicate silently drops/duplicates issues and there is no runtime
here to catch it. The issue-list view applies these via:

    qs = qs.filter(build_custom_field_filter(request.query_params))
    order = parse_custom_field_order_by(request.query_params.get("order_by"))
    if order: qs = qs.order_by(*order)
"""

from django.db.models import Q

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
