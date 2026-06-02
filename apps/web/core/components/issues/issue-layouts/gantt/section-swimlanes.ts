/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IGroupByColumn, TIssueMap } from "@plane/types";

/**
 * Section swimlanes for the Timeline (Gantt).
 *
 * The Gantt renders one row per entry in a single ordered `blockIds: string[]`
 * array — sidebar rows, chart rows, bars, and the dependency-arrow overlay all
 * derive their row Y as `index * BLOCK_HEIGHT`. To add Asana-style section
 * swimlanes we interleave *section-header sentinel ids* into that same array
 * (`[header(A), ...issuesOfA, header(B), ...issuesOfB]`). Because every layer
 * reads the same array by index and header rows are exactly one BLOCK_HEIGHT
 * tall, the index→Y math counts header rows automatically and the arrow overlay
 * needs no changes (a sentinel id is simply never an arrow endpoint).
 *
 * Grouping reuses the List's `group_by="section"` axis (docs/sections-design.md
 * §2: section is an axis independent of State). Issues are bucketed client-side
 * by `section_id` so the existing flat Gantt fetch is untouched.
 */

export const SECTION_HEADER_PREFIX = "section-header:";

/** The synthetic bucket id for issues with no section (mirrors getSectionColumns). */
export const NO_SECTION_GROUP_ID = "None";

/**
 * Asana-style section palette. ProjectSection has no colour field, so the tint
 * is derived client-side from the section's position in sort order (stable for
 * a given ordering). The "(No section)" bucket uses a neutral grey.
 */
export const SECTION_COLORS = ["#4573D2", "#8D4DC9", "#E8384F", "#1FA774", "#E8A33D", "#3FA3C2", "#D24595"] as const;
export const NO_SECTION_COLOR = "#9AA0A6";

export const getSectionColor = (groupId: string, orderIndex: number): string =>
  groupId === NO_SECTION_GROUP_ID ? NO_SECTION_COLOR : SECTION_COLORS[orderIndex % SECTION_COLORS.length];

/**
 * Solid status colour for task shapes (Asana-style): completed = green,
 * in-progress (started) = amber, everything else (backlog / unstarted /
 * cancelled / unknown) = grey. Keyed by the Plane state group.
 */
export const getStatusColor = (stateGroup: string | undefined | null): string => {
  switch (stateGroup) {
    case "completed":
      return "#16A34A"; // solid green
    case "started":
      return "#F59E0B"; // in progress — amber
    default:
      return "#9AA0A6"; // not done — grey
  }
};

export const isSectionHeaderId = (id: string): boolean => id.startsWith(SECTION_HEADER_PREFIX);

export const toSectionHeaderId = (sectionGroupId: string): string => `${SECTION_HEADER_PREFIX}${sectionGroupId}`;

export const sectionGroupIdFromHeader = (headerId: string): string => headerId.slice(SECTION_HEADER_PREFIX.length);

/**
 * Order issue ids by due date ascending (earliest first), so the Timeline reads
 * top-to-bottom in chronological order by default. Falls back to start_date, and
 * undated issues sort last. ISO date strings (YYYY-MM-DD) compare lexicographically.
 */
export const sortIssueIdsByDueDate = (ids: string[], issuesMap: TIssueMap): string[] => {
  const sortKey = (id: string): string => {
    const issue = issuesMap[id];
    return issue?.target_date || issue?.start_date || "9999-12-31";
  };
  return [...ids].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
};

/**
 * Bucket a flat, ordered list of issue ids by their section, using the ordered
 * section columns from `getGroupByColumns`. Every group gets a bucket (empty
 * sections still render a header, matching Asana); issues whose `section_id` is
 * null or points at an unknown/archived section fall into the "(No section)"
 * bucket. Each bucket is ordered by due date so each lane reads chronologically.
 */
export const bucketIssueIdsBySection = (
  issueIds: string[],
  issuesMap: TIssueMap,
  groups: IGroupByColumn[]
): Record<string, string[]> => {
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const buckets: Record<string, string[]> = {};
  groups.forEach((group) => {
    buckets[group.id] = [];
  });

  for (const issueId of issueIds) {
    const sectionId = issuesMap[issueId]?.section_id ?? null;
    const groupId = sectionId && knownGroupIds.has(sectionId) ? sectionId : NO_SECTION_GROUP_ID;
    // Guard against the "None" bucket not existing (groups always include it,
    // but stay defensive against an empty groups list).
    (buckets[groupId] ??= []).push(issueId);
  }

  // Order each lane chronologically by due date (Timeline default).
  for (const groupId of Object.keys(buckets)) {
    buckets[groupId] = sortIssueIdsByDueDate(buckets[groupId], issuesMap);
  }

  return buckets;
};

/**
 * Build the interleaved `blockIds` for section swimlanes: each section's header
 * sentinel followed by its issue ids, in `groups` order. A collapsed section
 * keeps its header row but drops its issue rows.
 */
export const buildSwimlaneBlockIds = (
  groups: IGroupByColumn[],
  issueIdsBySection: Record<string, string[]>,
  collapsedGroupIds: Set<string>
): string[] => {
  const blockIds: string[] = [];
  for (const group of groups) {
    blockIds.push(toSectionHeaderId(group.id));
    if (!collapsedGroupIds.has(group.id)) {
      blockIds.push(...(issueIdsBySection[group.id] ?? []));
    }
  }
  return blockIds;
};
