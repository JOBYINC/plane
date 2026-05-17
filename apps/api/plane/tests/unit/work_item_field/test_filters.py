# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the custom-field filter/sort helpers (design §8/§9).

These cover the *exact* logic the design gated as "do not wire blind":
a wrong predicate in build_custom_field_filter silently drops or
duplicates issues in every list view. The function is pure (builds a
Django Q, never touches the DB), so it is fully unit-testable without
Postgres. parse_custom_field_order_by's single DB hit is mocked.
"""

import pytest
from django.db.models import Q

from plane.app.views.work_item_field.filters import (
    build_custom_field_filter,
    parse_custom_field_order_by,
)
from plane.db.models import WorkItemField

pytestmark = pytest.mark.unit

_FILTERS_MODULE = "plane.app.views.work_item_field.filters"


class TestBuildCustomFieldFilter:
    def test_no_field_id_is_a_noop_empty_q(self):
        # Absent field_id -> empty Q() so the caller's .filter(Q()) is inert.
        assert build_custom_field_filter({}) == Q()

    def test_blank_field_id_is_a_noop(self):
        assert build_custom_field_filter({"field_values__field_id": ""}) == Q()

    def test_field_id_only_filters_on_the_field(self):
        result = build_custom_field_filter({"field_values__field_id": "abc"})
        assert result == Q(field_values__field_id="abc")

    def test_field_id_plus_text_value_ands_both(self):
        params = {
            "field_values__field_id": "fid",
            "field_values__value_text": "hello",
        }
        expected = Q(field_values__field_id="fid") & Q(field_values__value_text="hello")
        assert build_custom_field_filter(params) == expected

    def test_number_gte_suffix_preserved(self):
        params = {
            "field_values__field_id": "fid",
            "field_values__value_number__gte": "5",
        }
        expected = Q(field_values__field_id="fid") & Q(
            field_values__value_number__gte="5"
        )
        assert build_custom_field_filter(params) == expected

    def test_gt_is_not_swallowed_by_gte(self):
        # Regression guard: __gt must not be mis-detected as __gte (or vice
        # versa) by the endswith() suffix scan.
        params = {
            "field_values__field_id": "fid",
            "field_values__value_number__gt": "3",
        }
        expected = Q(field_values__field_id="fid") & Q(
            field_values__value_number__gt="3"
        )
        assert build_custom_field_filter(params) == expected

    def test_contains_maps_to_icontains(self):
        params = {
            "field_values__field_id": "fid",
            "field_values__value_text__contains": "ab",
        }
        expected = Q(field_values__field_id="fid") & Q(
            field_values__value_text__icontains="ab"
        )
        assert build_custom_field_filter(params) == expected

    def test_non_value_keys_are_ignored(self):
        params = {
            "field_values__field_id": "fid",
            "unrelated": "x",
            "field_values__something_else": "y",  # not field_values__value_*
        }
        assert build_custom_field_filter(params) == Q(field_values__field_id="fid")

    def test_multiple_value_predicates_all_and_together(self):
        params = {
            "field_values__field_id": "fid",
            "field_values__value_number__gte": "1",
            "field_values__value_number__lte": "10",
        }
        expected = (
            Q(field_values__field_id="fid")
            & Q(field_values__value_number__gte="1")
            & Q(field_values__value_number__lte="10")
        )
        assert build_custom_field_filter(params) == expected


class TestParseCustomFieldOrderBy:
    def test_none_returns_none(self):
        assert parse_custom_field_order_by(None) is None

    def test_empty_string_returns_none(self):
        assert parse_custom_field_order_by("") is None

    def test_non_custom_field_param_returns_none(self):
        assert parse_custom_field_order_by("created_at") is None
        assert parse_custom_field_order_by("-created_at") is None

    def test_unknown_field_returns_none(self, mocker):
        wif = mocker.patch(f"{_FILTERS_MODULE}.WorkItemField")
        wif.objects.filter.return_value.first.return_value = None
        assert parse_custom_field_order_by("custom_field__missing") is None

    @pytest.mark.parametrize(
        "field_type,expected_col",
        [
            (WorkItemField.FieldType.TEXT, "value_text"),
            (WorkItemField.FieldType.NUMBER, "value_number"),
            (WorkItemField.FieldType.DATE, "value_date"),
            (WorkItemField.FieldType.SINGLE_SELECT, "value_text"),
            (WorkItemField.FieldType.MULTI_SELECT, "value_multi"),
            (WorkItemField.FieldType.PEOPLE, "value_multi"),
        ],
    )
    def test_field_type_maps_to_value_column_ascending(
        self, mocker, field_type, expected_col
    ):
        wif = mocker.patch(f"{_FILTERS_MODULE}.WorkItemField")
        wif.objects.filter.return_value.first.return_value = mocker.Mock(
            field_type=field_type
        )
        result = parse_custom_field_order_by("custom_field__fid")
        assert result == [f"field_values__{expected_col}"]

    def test_desc_prefix_produces_descending_order(self, mocker):
        wif = mocker.patch(f"{_FILTERS_MODULE}.WorkItemField")
        wif.objects.filter.return_value.first.return_value = mocker.Mock(
            field_type=WorkItemField.FieldType.NUMBER
        )
        result = parse_custom_field_order_by("-custom_field__fid")
        assert result == ["-field_values__value_number"]
