/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observable, runInAction } from "mobx";
import type { IIssueDisplayProperties } from "@plane/types";

export type TListColumnKey =
  | "state"
  | "priority"
  | "due_date"
  | "start_date"
  | "assignee"
  | "labels"
  | "modules"
  | "cycle"
  | "estimate"
  | "sub_issue_count"
  | "attachment_count"
  | "link"
  | "created_on"
  | "updated_on";

export type TListColumnContext = {
  isEpic: boolean;
};

export const TITLE_COLUMN_MIN_WIDTH_PX = 320;
export const ACTIONS_COLUMN_WIDTH_PX = 56;

export const LIST_COLUMN_WIDTHS: Record<TListColumnKey, number> = {
  state: 140,
  priority: 110,
  due_date: 140,
  start_date: 140,
  assignee: 130,
  labels: 180,
  modules: 140,
  cycle: 130,
  estimate: 100,
  sub_issue_count: 76,
  attachment_count: 76,
  link: 76,
  created_on: 130,
  updated_on: 130,
};

export const LIST_COLUMN_ORDER: TListColumnKey[] = [
  "state",
  "priority",
  "due_date",
  "assignee",
  "labels",
  "start_date",
  "modules",
  "cycle",
  "estimate",
  "sub_issue_count",
  "attachment_count",
  "link",
  "created_on",
  "updated_on",
];

const COLUMN_TO_DISPLAY_KEY: Record<TListColumnKey, keyof IIssueDisplayProperties> = {
  state: "state",
  priority: "priority",
  due_date: "due_date",
  start_date: "start_date",
  assignee: "assignee",
  labels: "labels",
  modules: "modules",
  cycle: "cycle",
  estimate: "estimate",
  sub_issue_count: "sub_issue_count",
  attachment_count: "attachment_count",
  link: "link",
  created_on: "created_on",
  updated_on: "updated_on",
};

export function getDisplayPropertyKey(column: TListColumnKey): keyof IIssueDisplayProperties {
  return COLUMN_TO_DISPLAY_KEY[column];
}

function isColumnFeatureEnabled(column: TListColumnKey, ctx: TListColumnContext): boolean {
  if (ctx.isEpic && (column === "modules" || column === "cycle")) return false;
  return true;
}

export function getVisibleListColumns(
  displayProperties: IIssueDisplayProperties | undefined,
  ctx: TListColumnContext
): TListColumnKey[] {
  if (!displayProperties) return [];
  return LIST_COLUMN_ORDER.filter((column) => {
    if (!isColumnFeatureEnabled(column, ctx)) return false;
    const dpKey = COLUMN_TO_DISPLAY_KEY[column];
    return !!displayProperties[dpKey];
  });
}

export function getListGridTemplate(columns: TListColumnKey[]): string {
  const propertyTracks = columns.map((c) => `${LIST_COLUMN_WIDTHS[c]}px`).join(" ");
  return `minmax(${TITLE_COLUMN_MIN_WIDTH_PX}px, 1fr) ${propertyTracks} ${ACTIONS_COLUMN_WIDTH_PX}px`
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Runtime-registered custom columns (custom-fields branch — see
// docs/custom-fields-design.md §7). PURELY ADDITIVE: nothing above changed,
// so PR2/PR3 do not conflict here. Consumers (default.tsx, issue-cells.tsx,
// list-header-row.tsx) opt in via the helpers below.
// ---------------------------------------------------------------------------

export type TCustomListColumn = {
  key: string; // e.g. "custom_field__<uuid>"
  width: number;
  label: string;
};

const customColumnProviders: Array<() => TCustomListColumn[]> = [];

// MobX-observable so `observer` consumers (default.tsx List, block.tsx
// IssueBlock) re-render when the bridge registers its provider post-mount.
// Without this, the registry mutation is invisible to React and custom
// columns would never appear until an unrelated re-render. Bumped on
// (un)register; read by getCustomListColumns to establish the dependency.
const customColumnsVersion = observable.box(0);

function bumpCustomColumnsVersion(): void {
  runInAction(() => customColumnsVersion.set(customColumnsVersion.get() + 1));
}

export function registerListColumnProvider(provider: () => TCustomListColumn[]): () => void {
  customColumnProviders.push(provider);
  bumpCustomColumnsVersion();
  return () => {
    const idx = customColumnProviders.indexOf(provider);
    if (idx >= 0) {
      customColumnProviders.splice(idx, 1);
      bumpCustomColumnsVersion();
    }
  };
}

export function getCustomListColumns(): TCustomListColumn[] {
  customColumnsVersion.get(); // reactive dep: re-run when providers (un)register
  return customColumnProviders.flatMap((provider) => provider());
}

export function getCustomColumnWidth(key: string): number | undefined {
  return getCustomListColumns().find((c) => c.key === key)?.width;
}

export function getCustomColumnLabel(key: string): string | undefined {
  return getCustomListColumns().find((c) => c.key === key)?.label;
}

export const CUSTOM_COLUMN_KEY_PREFIX = "custom_field__";

export function isCustomColumnKey(key: string): boolean {
  return key.startsWith(CUSTOM_COLUMN_KEY_PREFIX);
}

export function customColumnKeyToFieldId(key: string): string {
  return key.slice(CUSTOM_COLUMN_KEY_PREFIX.length);
}

// Grid template that also lays out registered custom columns. default.tsx
// swaps getListGridTemplate -> this once it also appends
// getCustomListColumns() keys to the rendered column list (the gated wiring
// edits documented in design §7).
export function getListGridTemplateWithCustom(builtIn: TListColumnKey[]): string {
  const builtInTracks = builtIn.map((c) => `${LIST_COLUMN_WIDTHS[c]}px`).join(" ");
  const customTracks = getCustomListColumns()
    .map((c) => `${c.width}px`)
    .join(" ");
  return `minmax(${TITLE_COLUMN_MIN_WIDTH_PX}px, 1fr) ${builtInTracks} ${customTracks} ${ACTIONS_COLUMN_WIDTH_PX}px`
    .replace(/\s+/g, " ")
    .trim();
}
