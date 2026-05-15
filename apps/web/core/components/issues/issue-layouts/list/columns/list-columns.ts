/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

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
