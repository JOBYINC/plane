/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Archive, MoreHorizontal, Pencil } from "lucide-react";
// ui
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueGroupByOptions } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useProjectSection } from "@/hooks/store/use-project-section";

interface ISectionGroupActions {
  groupBy: TIssueGroupByOptions;
  groupId: string;
  title: string;
}

// Distinct from the existing "ISSUE" / "COLUMN" drag types so section
// reorder never interferes with row-drag or workflow-column drag
// (docs/sections-design.md §6.2). Float gap for an at-the-top drop.
const SECTION_DRAG_TYPE = "SECTION";
const SECTION_SORT_GAP = 10000;

/**
 * Inline rename + ⋯ (rename / archive) + drag-to-reorder for a Section
 * group header (docs/sections-design.md §6.2 / §5). Self-gates: renders
 * nothing unless grouping by "section" AND this is a real section (the
 * synthetic "(No section)" bucket, id "None", has no controls).
 *
 * The SECTION drag/drop is fully confined to THIS component's own
 * element — it adds no handlers to the shared list-group COLUMN/ISSUE
 * dnd, so core issue drag is untouched. Reorder writes a float
 * sort_order between neighbours; pure organizational move, never reads
 * or writes State (§2).
 */
export const SectionGroupActions = observer(function SectionGroupActions(props: ISectionGroupActions) {
  const { groupBy, groupId, title } = props;
  const { workspaceSlug, projectId } = useParams();
  const { renameSection, archiveSection, reorderSection, getSections } = useProjectSection();
  // states
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(title);
  // Focus the rename input when it appears (replaces autoFocus — a11y).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const isRealSection = groupBy === "section" && groupId !== "None";

  // SECTION reorder dnd — isolated to this element. Drops the dragged
  // section just before this one and writes a float sort_order between
  // neighbours (same trick used elsewhere in Plane).
  const dragRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dragRef.current;
    if (!element || !isRealSection || !ws || !pid) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({ sectionId: groupId, type: SECTION_DRAG_TYPE }),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data?.type === SECTION_DRAG_TYPE,
        getData: () => ({ sectionId: groupId, type: SECTION_DRAG_TYPE }),
        onDrop: ({ source }) => {
          const sourceId = source.data?.sectionId as string | undefined;
          if (!sourceId || sourceId === groupId) return;

          const ordered = getSections(pid);
          const targetIndex = ordered.findIndex((s) => s.id === groupId);
          if (targetIndex === -1) return;

          const target = ordered[targetIndex];
          const prev = ordered[targetIndex - 1];
          // No-op if the dragged section is already right before target.
          if (prev && prev.id === sourceId) return;

          const newSortOrder = prev ? (prev.sort_order + target.sort_order) / 2 : target.sort_order - SECTION_SORT_GAP;

          reorderSection(ws, pid, sourceId, newSortOrder).catch(() => {
            setToast({ type: TOAST_TYPE.ERROR, title: "Error!", message: "Could not reorder the section." });
          });
        },
      })
    );
  }, [groupId, isRealSection, ws, pid, getSections, reorderSection]);

  // Only real sections get controls — not the "(No section)" bucket.
  if (!isRealSection || !ws || !pid) return null;

  const commitRename = async () => {
    const next = draftName.trim();
    setIsEditing(false);
    if (!next || next === title) {
      setDraftName(title);
      return;
    }
    try {
      await renameSection(ws, pid, groupId, next);
    } catch {
      setDraftName(title);
      setToast({ type: TOAST_TYPE.ERROR, title: "Error!", message: "Could not rename the section." });
    }
  };

  const handleArchive = async () => {
    try {
      await archiveSection(ws, pid, groupId);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Archived", message: `Section "${title}" archived.` });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error!", message: "Could not archive the section." });
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="text-sm rounded-xs border border-strong bg-surface-1 px-1 py-0.5 font-medium text-primary outline-none"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") {
            setDraftName(title);
            setIsEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div ref={dragRef} className="flex flex-shrink-0 cursor-grab items-center active:cursor-grabbing">
      <CustomMenu
        customButton={
          <span className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xs opacity-0 transition-all group-hover/list-header:opacity-100 hover:bg-layer-1">
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        }
      >
        <CustomMenu.MenuItem
          onClick={() => {
            setDraftName(title);
            setIsEditing(true);
          }}
        >
          <span className="flex items-center justify-start gap-2">
            <Pencil className="h-3 w-3" />
            Rename
          </span>
        </CustomMenu.MenuItem>
        <CustomMenu.MenuItem onClick={handleArchive}>
          <span className="flex items-center justify-start gap-2">
            <Archive className="h-3 w-3" />
            Archive
          </span>
        </CustomMenu.MenuItem>
      </CustomMenu>
    </div>
  );
});
