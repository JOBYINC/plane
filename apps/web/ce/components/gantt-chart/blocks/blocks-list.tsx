/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

//
import type { IBlockUpdateDependencyData } from "@plane/types";
import { GanttChartBlock } from "@/components/gantt-chart/blocks/block";
import { SectionSwimlaneBlockSpacer } from "@/components/issues/issue-layouts/gantt/section-swimlane-rows";
import { isSectionHeaderId } from "@/components/issues/issue-layouts/gantt/section-swimlanes";

export type GanttChartBlocksProps = {
  blockIds: string[];
  blockToRender: (data: any) => React.ReactNode;
  enableBlockLeftResize: boolean | ((blockId: string) => boolean);
  enableBlockRightResize: boolean | ((blockId: string) => boolean);
  enableBlockMove: boolean | ((blockId: string) => boolean);
  ganttContainerRef: React.RefObject<HTMLDivElement>;
  showAllBlocks: boolean;
  updateBlockDates?: (updates: IBlockUpdateDependencyData[]) => Promise<void>;
  enableDependency: boolean | ((blockId: string) => boolean);
};

export function GanttChartBlocksList(props: GanttChartBlocksProps) {
  const {
    blockIds,
    blockToRender,
    enableBlockLeftResize,
    enableBlockRightResize,
    enableBlockMove,
    ganttContainerRef,
    showAllBlocks,
    updateBlockDates,
    enableDependency,
  } = props;

  return (
    <>
      {blockIds?.map((blockId) =>
        isSectionHeaderId(blockId) ? (
          // Section header occupies one BLOCK_HEIGHT row here too, so the flow-
          // stacked bars below keep their index→Y alignment with the arrows.
          <SectionSwimlaneBlockSpacer key={blockId} />
        ) : (
          <GanttChartBlock
            key={blockId}
            blockId={blockId}
            showAllBlocks={showAllBlocks}
            blockToRender={blockToRender}
            enableBlockLeftResize={
              typeof enableBlockLeftResize === "function" ? enableBlockLeftResize(blockId) : enableBlockLeftResize
            }
            enableBlockRightResize={
              typeof enableBlockRightResize === "function" ? enableBlockRightResize(blockId) : enableBlockRightResize
            }
            enableBlockMove={typeof enableBlockMove === "function" ? enableBlockMove(blockId) : enableBlockMove}
            enableDependency={typeof enableDependency === "function" ? enableDependency(blockId) : enableDependency}
            ganttContainerRef={ganttContainerRef}
            updateBlockDates={updateBlockDates}
          />
        )
      )}
    </>
  );
}
