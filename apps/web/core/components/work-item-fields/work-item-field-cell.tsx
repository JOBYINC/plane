/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { TWorkItemField, TWorkItemFieldValue } from "@plane/types";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";

interface WorkItemFieldCellProps {
  field: TWorkItemField;
  issueId: string;
  projectId: string;
  isReadOnly?: boolean;
}

/**
 * Asana-style per-type renderer for one custom field on one issue.
 * Reused by the list-view bridge and the peek panel. text/number/date/
 * single_select are inline-editable; multi_select/people render colored
 * chips (full multi-pickers live in the peek panel — KISS for v1).
 */
export const WorkItemFieldCell = observer(function WorkItemFieldCell(props: WorkItemFieldCellProps) {
  const { field, issueId, projectId, isReadOnly } = props;
  const { workspaceSlug } = useParams();
  const { getValueForIssue, upsertValue } = useWorkItemField();
  const ws = workspaceSlug?.toString() ?? "";
  const value = getValueForIssue(issueId, field.id);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));

  const commit = async (next: TWorkItemFieldValue) => {
    if (isReadOnly) return;
    try {
      await upsertValue(ws, projectId, issueId, field.id, next);
    } catch {
      // store rolls back optimistic update; surface nothing in the cell
    }
  };

  const activeOptions = field.options.filter((o) => o.is_active);
  const optionById = (id: string) => activeOptions.find((o) => o.id === id);

  if (field.field_type === "text") {
    return (
      <input
        type="text"
        aria-label={field.name}
        disabled={isReadOnly}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? "") && commit(draft)}
        className="w-full truncate bg-transparent text-13 text-secondary outline-none disabled:opacity-60"
      />
    );
  }

  if (field.field_type === "number") {
    return (
      <input
        type="number"
        aria-label={field.name}
        disabled={isReadOnly}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft === "" ? null : Number(draft))}
        className="w-full truncate bg-transparent text-13 text-secondary outline-none disabled:opacity-60"
      />
    );
  }

  if (field.field_type === "date") {
    return (
      <input
        type="date"
        aria-label={field.name}
        disabled={isReadOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => commit(e.target.value || null)}
        className="w-full bg-transparent text-13 text-secondary outline-none disabled:opacity-60"
      />
    );
  }

  if (field.field_type === "single_select") {
    const selected = typeof value === "string" ? optionById(value) : undefined;
    return (
      <select
        aria-label={field.name}
        disabled={isReadOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => commit(e.target.value || null)}
        className="w-full bg-transparent text-13 text-secondary outline-none disabled:opacity-60"
        style={selected ? { color: selected.color } : undefined}
      >
        <option value="">—</option>
        {activeOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
    );
  }

  // multi_select / people — display chips (edited from the peek panel)
  const ids = Array.isArray(value) ? value : [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {ids.length === 0 && <span className="text-13 text-placeholder">—</span>}
      {field.field_type === "multi_select"
        ? ids.map((id) => {
            const opt = optionById(id);
            return (
              <span
                key={id}
                className="truncate rounded px-1.5 py-0.5 text-11"
                style={{ backgroundColor: `${opt?.color ?? "#6B7280"}20`, color: opt?.color ?? "#6B7280" }}
              >
                {opt?.name ?? id}
              </span>
            );
          })
        : ids.map((id) => (
            <span key={id} className="truncate rounded bg-surface-2 px-1.5 py-0.5 text-11 text-secondary">
              {id}
            </span>
          ))}
    </div>
  );
});
