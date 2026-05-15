/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { TWorkItemField, TWorkItemFieldValue } from "@plane/types";
import { CustomSelect } from "@plane/ui";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";

interface WorkItemFieldCellProps {
  field: TWorkItemField;
  issueId: string;
  projectId: string;
  isReadOnly?: boolean;
}

/**
 * Asana-style per-type renderer for one custom field on one issue.
 * Reused by the list-view bridge and the peek panel.
 *
 * The whole cell is wrapped in a stopPropagation guard: in the list the
 * row is a ControlLink whose onClick opens the issue peek (block.tsx),
 * so without this a click on the field would navigate away instead of
 * editing inline (mirrors the built-in cells' `Wrap`). We intentionally
 * do NOT preventDefault — that would stop inputs from focusing.
 *
 * single_select uses Plane's native CustomSelect (colored chip + popover
 * like StateDropdown), date uses the native DateDropdown calendar;
 * text/number are inline inputs (parity with Plane's native text/number
 * property inputs). multi_select/people render colored chips (full
 * multi-pickers live in the peek panel — KISS for v1).
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

  let inner: React.ReactNode;

  if (field.field_type === "text") {
    inner = (
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
  } else if (field.field_type === "number") {
    inner = (
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
  } else if (field.field_type === "date") {
    inner = (
      <DateDropdown
        value={typeof value === "string" ? value : null}
        onChange={(d) => commit((d ? renderFormattedPayloadDate(d) : null) ?? null)}
        placeholder={field.name}
        disabled={isReadOnly}
        buttonVariant={typeof value === "string" && value ? "border-with-text" : "border-without-text"}
        buttonClassName="text-13"
        optionsClassName="z-20"
      />
    );
  } else if (field.field_type === "single_select") {
    const selected = typeof value === "string" ? optionById(value) : undefined;
    inner = (
      <CustomSelect
        value={typeof value === "string" ? value : ""}
        disabled={isReadOnly}
        onChange={(val: string) => commit(val || null)}
        maxHeight="md"
        optionsClassName="z-20 min-w-[10rem]"
        buttonClassName="w-full justify-between rounded border border-strong px-1.5 py-0.5 text-13"
        label={
          selected ? (
            <span className="flex items-center gap-1.5 truncate">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />
              <span className="truncate" style={{ color: selected.color }}>
                {selected.name}
              </span>
            </span>
          ) : (
            <span className="text-placeholder">—</span>
          )
        }
      >
        <CustomSelect.Option value="">
          <span className="text-placeholder">—</span>
        </CustomSelect.Option>
        {activeOptions.map((opt) => (
          <CustomSelect.Option key={opt.id} value={opt.id}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
              <span className="truncate">{opt.name}</span>
            </span>
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    );
  } else {
    // multi_select / people — display chips (full picker = peek panel, v1)
    const ids = Array.isArray(value) ? value : [];
    inner = (
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
  }

  // stopPropagation only (NO preventDefault — inputs must still focus).
  // Keeps a click/focus inside the cell from bubbling to the row's
  // peek-overview ControlLink, so editing happens inline.
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className="w-full min-w-0" onClick={(e) => e.stopPropagation()} onFocusCapture={(e) => e.stopPropagation()}>
      {inner}
    </div>
  );
});
