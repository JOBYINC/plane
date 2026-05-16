# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import AutomationRule, AutomationRuleRun, AutomationTriggerType
from .base import BaseSerializer


# Supported (action_type, required config keys, optional keys). Used to
# validate the actions list at serializer time so bad rules can't be saved.
_ACTION_SHAPES = {
    "set_state": {"either": [["state_id"], ["state_group"]]},
    "set_priority": {"required": ["priority"]},
    "add_assignee": {"required": ["user_id"]},
    "remove_assignee": {"required": ["user_id"]},
    "add_label": {"required": ["label_id"]},
    "set_target_date": {"either": [["target_date"], ["days_from_now"]]},
    "notify_lark": {"optional": ["message", "to"]},
    "webhook": {"required": ["url"], "optional": ["payload"]},
}

# Supported condition operators -- enforced so the engine's
# _evaluate_condition always sees something it can handle.
_VALID_CONDITION_OPS = {
    "eq",
    "ne",
    "in",
    "not_in",
    "gt",
    "lt",
    "contains",
    "is_null",
    "is_not_null",
}

_VALID_CONDITION_FIELDS = {
    "priority",
    "state",
    "state_group",
    "assignee_ids",
    "label_ids",
    "target_date",
    "start_date",
    "sequence_id",
}


def _validate_actions(actions):
    if not isinstance(actions, list):
        raise serializers.ValidationError("actions must be a list")
    for idx, action in enumerate(actions):
        if not isinstance(action, dict):
            raise serializers.ValidationError(f"actions[{idx}] must be an object")
        action_type = action.get("type")
        shape = _ACTION_SHAPES.get(action_type)
        if shape is None:
            raise serializers.ValidationError(
                f"actions[{idx}]: unknown action type {action_type!r}"
            )
        config = action.get("config") or {}
        if "required" in shape:
            for key in shape["required"]:
                if key not in config:
                    raise serializers.ValidationError(
                        f"actions[{idx}]: missing required config key {key!r}"
                    )
        if "either" in shape:
            if not any(all(k in config for k in alt) for alt in shape["either"]):
                opts = " | ".join(", ".join(alt) for alt in shape["either"])
                raise serializers.ValidationError(
                    f"actions[{idx}]: must specify one of: {opts}"
                )


def _validate_conditions(conditions):
    if not isinstance(conditions, list):
        raise serializers.ValidationError("conditions must be a list")
    for idx, p in enumerate(conditions):
        if not isinstance(p, dict):
            raise serializers.ValidationError(f"conditions[{idx}] must be an object")
        if p.get("field") not in _VALID_CONDITION_FIELDS:
            raise serializers.ValidationError(
                f"conditions[{idx}]: unknown field {p.get('field')!r}"
            )
        if p.get("op") not in _VALID_CONDITION_OPS:
            raise serializers.ValidationError(
                f"conditions[{idx}]: unknown op {p.get('op')!r}"
            )


class AutomationRuleSerializer(BaseSerializer):
    class Meta:
        model = AutomationRule
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "description",
            "trigger_type",
            "trigger_config",
            "conditions",
            "actions",
            "is_active",
            "last_fired_at",
            "fire_count",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "last_fired_at",
            "fire_count",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

    def validate_trigger_type(self, value):
        valid = {t[0] for t in AutomationTriggerType.choices}
        if value not in valid:
            raise serializers.ValidationError(f"invalid trigger_type {value!r}")
        return value

    def validate_actions(self, value):
        _validate_actions(value)
        return value

    def validate_conditions(self, value):
        _validate_conditions(value)
        return value


class AutomationRuleRunSerializer(BaseSerializer):
    class Meta:
        model = AutomationRuleRun
        fields = [
            "id",
            "rule",
            "issue",
            "status",
            "detail",
            "created_at",
        ]
        read_only_fields = fields
