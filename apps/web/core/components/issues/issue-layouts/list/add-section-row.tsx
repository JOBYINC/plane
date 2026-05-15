/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
// ui
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueGroupByOptions } from "@plane/types";
// hooks
import { useProjectSection } from "@/hooks/store/use-project-section";

interface IAddSectionRow {
  groupBy: TIssueGroupByOptions;
}

/**
 * "+ Add section" affordance at the bottom of the list, the way Asana
 * places it after the last section (docs/sections-design.md §6.2).
 * Self-gates to group_by = "section". Optimistic insert is handled by
 * ProjectSectionStore.createSection (server auto-appends sort_order).
 *
 * Pure organizational CRUD — never touches State (§2).
 */
export const AddSectionRow = observer(function AddSectionRow(props: IAddSectionRow) {
  const { groupBy } = props;
  const { workspaceSlug, projectId } = useParams();
  const { createSection } = useProjectSection();
  // states
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Focus the input when it appears (replaces autoFocus — a11y).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  if (groupBy !== "section") return null;

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  if (!ws || !pid) return null;

  const reset = () => {
    setName("");
    setIsAdding(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      reset();
      return;
    }
    setIsSubmitting(true);
    try {
      await createSection(ws, pid, { name: trimmed });
      reset();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error!", message: "Could not create the section." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAdding) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={inputRef}
          disabled={isSubmitting}
          className="text-sm w-64 rounded-xs border border-strong bg-surface-1 px-2 py-1 text-primary outline-none"
          placeholder="Section name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") reset();
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsAdding(true)}
      className="text-sm flex items-center gap-1.5 px-3 py-2 font-medium text-tertiary transition-colors hover:text-primary"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      Add section
    </button>
  );
});
