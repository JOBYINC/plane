/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
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

/**
 * Inline rename + ⋯ (rename / archive) for a Section group header
 * (docs/sections-design.md §6.2). Self-gates: renders nothing unless
 * grouping by "section" AND this is a real section (the synthetic
 * "(No section)" bucket, id "None", has no controls). Reorder is the
 * SECTION drag (step 7), not a menu item.
 *
 * Pure organizational CRUD — never reads or writes State (§2).
 */
export const SectionGroupActions = observer(function SectionGroupActions(props: ISectionGroupActions) {
  const { groupBy, groupId, title } = props;
  const { workspaceSlug, projectId } = useParams();
  const { renameSection, archiveSection } = useProjectSection();
  // states
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(title);
  // Focus the rename input when it appears (replaces autoFocus — a11y).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  // Only real sections get controls — not the "(No section)" bucket.
  if (groupBy !== "section" || groupId === "None") return null;

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  if (!ws || !pid) return null;

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
  );
});
