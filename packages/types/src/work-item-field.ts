/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Project-scoped custom fields. Mirrors Asana's field set (no boolean —
// Asana models yes/no as a 2-option single-select). See
// docs/custom-fields-design.md.
export type TWorkItemFieldType = "text" | "number" | "date" | "single_select" | "multi_select" | "people";

export interface TWorkItemFieldOption {
  id: string;
  field: string;
  project_id: string;
  workspace_id: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

export interface TWorkItemField {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  field_type: TWorkItemFieldType;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
  description: string;
  config: Record<string, unknown>;
  // Hydrated for single_select / multi_select; [] otherwise.
  options: TWorkItemFieldOption[];
}

// Field types that own a set of selectable options.
export const WORK_ITEM_FIELD_OPTION_TYPES: TWorkItemFieldType[] = ["single_select", "multi_select"];

// Normalized per-issue value (server returns one of these per field_type,
// see design §3): text/single_select -> string, number -> number,
// date -> ISO string, multi_select/people -> string[]. null = unset.
export type TWorkItemFieldValue = string | number | string[] | null;

// One issue's value row as returned by the value endpoints.
export interface TWorkItemFieldValueRow {
  id: string;
  field: string;
  issue: string;
  value: TWorkItemFieldValue;
  created_at: string;
  updated_at: string;
}
