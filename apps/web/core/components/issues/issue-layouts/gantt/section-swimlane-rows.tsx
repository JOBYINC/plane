/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ChevronRightIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
// constants
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
// local
import { useSectionSwimlane } from "./section-swimlane-context";

type RowProps = {
  /** section group id (ProjectSection id or the "None" bucket). */
  groupId: string;
};

/**
 * Section header in the Gantt sidebar — chevron (collapse), colour dot, name and
 * issue count. Exactly one BLOCK_HEIGHT tall so the chart/sidebar/arrow row Y
 * stays aligned (see ./section-swimlanes.ts). Clicking toggles collapse.
 */
export const SectionSwimlaneSidebarRow = observer(function SectionSwimlaneSidebarRow({ groupId }: RowProps) {
  const { sectionsById, collapsedIds, toggleCollapse } = useSectionSwimlane();
  const section = sectionsById[groupId];
  if (!section) return <div className="w-full" style={{ height: `${BLOCK_HEIGHT}px` }} />;

  const isCollapsed = collapsedIds.has(groupId);
  return (
    <button
      type="button"
      onClick={() => toggleCollapse(groupId)}
      aria-expanded={!isCollapsed}
      className="flex w-full items-center gap-2 px-3 text-left hover:bg-layer-transparent-hover"
      style={{ height: `${BLOCK_HEIGHT}px` }}
    >
      <ChevronRightIcon
        className={cn("size-4 flex-shrink-0 text-tertiary transition-transform", { "rotate-90": !isCollapsed })}
      />
      <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: section.color }} />
      <span className="text-sm truncate font-semibold text-primary">{section.name}</span>
      <span className="flex-shrink-0 text-13 text-secondary">{section.count}</span>
    </button>
  );
});

/**
 * Chart-side section band — a full-width row at the same Y as the sidebar header,
 * tinted faintly with the section colour. Keeps the chart grid row present so
 * bars below it (and the dependency overlay) stay aligned.
 */
export const SectionSwimlaneChartRow = observer(function SectionSwimlaneChartRow({ groupId }: RowProps) {
  const { sectionsById } = useSectionSwimlane();
  const color = sectionsById[groupId]?.color;
  return (
    <div className="relative w-full border-b border-subtle bg-surface-2/40" style={{ height: `${BLOCK_HEIGHT}px` }}>
      {color && <div className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ backgroundColor: color }} />}
    </div>
  );
});

/**
 * Invisible spacer the bar layer renders in place of a header, so the flow-
 * stacked bars keep one BLOCK_HEIGHT row per header and never shift up.
 */
export const SectionSwimlaneBlockSpacer = function SectionSwimlaneBlockSpacer() {
  return <div className="pointer-events-none w-full" style={{ height: `${BLOCK_HEIGHT}px` }} />;
};
