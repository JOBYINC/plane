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

// horizontal control-point offset for the bezier elbow (px)
const CONNECTOR_CURVE = 24;

/**
 * Builds the cubic-bezier "elbow" path from a source bar's right edge to a
 * target bar's left edge, with horizontal tangents at both ends so the line
 * reads like Asana's dependency connectors.
 */
const buildConnectorPath = ({ x1, y1, x2, y2 }: TDependencyEdge): string =>
  `M ${x1} ${y1} C ${x1 + CONNECTOR_CURVE} ${y1}, ${x2 - CONNECTOR_CURVE} ${y2}, ${x2} ${y2}`;

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
        x1: sourceBlock.position.marginLeft + sourceBlock.position.width,
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
          markerEnd="url(#gantt-dependency-arrow)"
        />
      ))}
    </svg>
  );
});
