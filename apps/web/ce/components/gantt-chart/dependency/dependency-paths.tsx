/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EIssueServiceType } from "@plane/types";
// constants
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";

type Props = {
  isEpic?: boolean;
};

type TDependencyEdge = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

// orthogonal routing constants (px)
const CONNECTOR_STUB = 14; // horizontal stub into the left gutter before turning
const CONNECTOR_RADIUS = 8; // rounded-corner radius at the bends

/**
 * Builds an Asana-style orthogonal connector with rounded corners, routed in the
 * LEFT gutter so it never crosses the task labels (which sit to the RIGHT of each
 * marker). Both endpoints attach on the LEFT edge of their marker: exit the
 * source's left edge, a short stub further left, a vertical run down/up in the
 * gutter, then a horizontal run rightward into the target's left edge (arrowhead).
 * `x1`/`x2` are the LEFT edges of the source/target markers.
 */
const buildConnectorPath = ({ x1, y1, x2, y2 }: TDependencyEdge): string => {
  // (near-)same row → straight horizontal line
  if (Math.abs(y2 - y1) < 2) return `M ${x1} ${y1} H ${x2}`;
  const dir = y2 > y1 ? 1 : -1; // vertical direction
  // vertical run sits in the gutter, just left of the earlier of the two markers
  const gx = Math.min(x1, x2) - CONNECTOR_STUB;
  const r = Math.max(2, Math.min(CONNECTOR_RADIUS, Math.abs(y2 - y1) / 2, Math.abs(x1 - gx), Math.abs(x2 - gx)));
  return (
    `M ${x1} ${y1} H ${gx + r} ` +
    `Q ${gx} ${y1} ${gx} ${y1 + dir * r} ` +
    `V ${y2 - dir * r} ` +
    `Q ${gx} ${y2} ${gx + r} ${y2} ` +
    `H ${x2}`
  );
};

/**
 * Asana-style dependency connectors for the Timeline (Gantt).
 *
 * Draws one arrow per "blocking" relation: from the blocking task's bar-end to
 * the blocked task's bar-start. Reads live block geometry from the timeline
 * store (mobx-observed) so connectors follow bars during drag/resize, and
 * relation ids from the issue-detail relation store (hydrated in bulk from the
 * gantt list payload's `issue_relation` expand — gated by ENABLE_ISSUE_DEPENDENCIES).
 */
export const TimelineDependencyPaths = observer(function TimelineDependencyPaths(props: Props) {
  const { isEpic = false } = props;
  // store hooks
  const { blockIds, getBlockById } = useTimeLineChartStore();
  const {
    relation: { getRelationByIssueIdRelationType },
  } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);

  if (!blockIds || blockIds.length === 0) return null;

  // blockId -> row index (row Y = index * BLOCK_HEIGHT)
  const indexById = new Map<string, number>();
  blockIds.forEach((id, index) => indexById.set(id, index));

  const edges: TDependencyEdge[] = [];
  for (const sourceId of blockIds) {
    const sourceBlock = getBlockById(sourceId);
    if (!sourceBlock?.position) continue;
    const sourceIndex = indexById.get(sourceId);
    if (sourceIndex === undefined) continue;

    // "blocking" = issues this one blocks → arrow source → target
    const targetIds = getRelationByIssueIdRelationType(sourceId, "blocking") ?? [];
    for (const targetId of targetIds) {
      const targetIndex = indexById.get(targetId);
      if (targetIndex === undefined) continue; // related issue not on the current chart
      const targetBlock = getBlockById(targetId);
      if (!targetBlock?.position) continue; // related issue has no dates

      edges.push({
        key: `${sourceId}->${targetId}`,
        // Left edges of both markers — route in the left gutter, away from labels.
        x1: sourceBlock.position.marginLeft,
        y1: sourceIndex * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        x2: targetBlock.position.marginLeft,
        y2: targetIndex * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
      });
    }
  }

  if (edges.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full overflow-visible text-tertiary"
      aria-hidden
    >
      <defs>
        <marker
          id="gantt-dependency-arrow"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 6 4 L 0 7 z" fill="context-stroke" />
        </marker>
      </defs>
      {edges.map((edge) => (
        <path
          key={edge.key}
          d={buildConnectorPath(edge)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          markerEnd="url(#gantt-dependency-arrow)"
        />
      ))}
    </svg>
  );
});
