/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

// Mirrors the AutomationRule model in apps/api/plane/db/models/automation.py.
// Kept inline because @plane/types doesn't have these yet and we don't want
// to widen the public types package surface for an internal feature.
export type AutomationTriggerType =
  | "state_changed"
  | "assignee_added"
  | "assignee_removed"
  | "priority_changed"
  | "target_date_changed"
  | "labels_changed"
  | "comment_added"
  | "due_soon"
  | "scheduled";

export type AutomationConditionOp =
  | "eq"
  | "ne"
  | "in"
  | "not_in"
  | "gt"
  | "lt"
  | "contains"
  | "is_null"
  | "is_not_null";

export type AutomationConditionField =
  | "priority"
  | "state"
  | "state_group"
  | "assignee_ids"
  | "label_ids"
  | "target_date"
  | "start_date"
  | "sequence_id";

export type AutomationActionType =
  | "set_state"
  | "set_priority"
  | "add_assignee"
  | "remove_assignee"
  | "add_label"
  | "set_target_date"
  | "notify_lark"
  | "webhook";

export interface AutomationCondition {
  field: AutomationConditionField;
  op: AutomationConditionOp;
  value: unknown;
}

export interface AutomationAction {
  type: AutomationActionType;
  config: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  is_active: boolean;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type AutomationRulePayload = Partial<
  Pick<
    AutomationRule,
    "name" | "description" | "trigger_type" | "trigger_config" | "conditions" | "actions" | "is_active"
  >
>;

export interface AutomationRuleRun {
  id: string;
  rule: string;
  issue: string | null;
  status: "success" | "skipped_condition" | "skipped_dedup" | "skipped_loop" | "error";
  detail: Record<string, unknown>;
  created_at: string;
}

export class ProjectAutomationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string, projectId: string): Promise<AutomationRule[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, projectId: string, ruleId: string): Promise<AutomationRule> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/${ruleId}/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }

  async create(workspaceSlug: string, projectId: string, data: AutomationRulePayload): Promise<AutomationRule> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    ruleId: string,
    data: AutomationRulePayload
  ): Promise<AutomationRule> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/${ruleId}/`, data)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response;
      });
  }

  async destroy(workspaceSlug: string, projectId: string, ruleId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/${ruleId}/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response;
      });
  }

  async listRuns(workspaceSlug: string, projectId: string, ruleId: string): Promise<AutomationRuleRun[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/automation-rules/${ruleId}/runs/`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }
}
