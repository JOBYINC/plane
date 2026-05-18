/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkItemField, TWorkItemFieldOption, TWorkItemFieldValue } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { cn, renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { LABEL_PILL_CLASS, labelPillStyle } from "@/components/issues/label";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { useUserPermissions } from "@/hooks/store/user";
import { WorkItemFieldEditorModal } from "./work-item-field-editor-modal";

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
 * single_select & multi_select use an inline CustomMenu (colored chip +
 * popover); body-portaled dropdowns are unreachable inside the issue
 * peek's focus lock, so cells must render dropdowns inline. date uses
 * the native DateDropdown calendar;
 * text/number are inline inputs (parity with Plane's native text/number
 * property inputs). people reuses Plane's native MemberDropdown (multi),
 * multi_select is a colored-chip toggle popover — both edit inline.
 */
export const WorkItemFieldCell = observer(function WorkItemFieldCell(props: WorkItemFieldCellProps) {
  const { field, issueId, projectId, isReadOnly } = props;
  const { workspaceSlug } = useParams();
  const { getValueForIssue, upsertValue } = useWorkItemField();
  const ws = workspaceSlug?.toString() ?? "";
  const value = getValueForIssue(issueId, field.id);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const canManageFields = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  const commit = async (next: TWorkItemFieldValue) => {
    if (isReadOnly) return;
    try {
      await upsertValue(ws, projectId, issueId, field.id, next);
    } catch {
      // store rolls back optimistic update; surface nothing in the cell
    }
  };

  const activeOptions = (field.options ?? []).filter((o) => o.is_active);
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
      />
    );
  } else if (field.field_type === "single_select") {
    const selected = typeof value === "string" ? optionById(value) : undefined;
    inner = (
      <CustomMenu
        closeOnSelect
        disabled={isReadOnly}
        placement="bottom-start"
        optionsClassName="z-20 min-w-[10rem]"
        customButton={
          <div className="flex min-h-[1.75rem] w-full items-center gap-1 px-0.5 py-0.5">
            {selected ? (
              <span
                className={cn(LABEL_PILL_CLASS, "max-w-full overflow-hidden")}
                style={labelPillStyle(selected.color)}
              >
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="text-13 text-placeholder">—</span>
            )}
          </div>
        }
      >
        <CustomMenu.MenuItem onClick={() => commit(null)}>
          <span className="flex items-center gap-2">
            <span className="flex-1 text-placeholder">—</span>
            {!selected && <Check className="size-3.5 flex-shrink-0" />}
          </span>
        </CustomMenu.MenuItem>
        {activeOptions.map((opt) => {
          const isSelected = selected?.id === opt.id;
          return (
            <CustomMenu.MenuItem key={opt.id} onClick={() => commit(opt.id)}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
                <span className="flex-1 truncate">{opt.name}</span>
                {isSelected && <Check className="size-3.5 flex-shrink-0" />}
              </span>
            </CustomMenu.MenuItem>
          );
        })}
        {canManageFields && (
          <CustomMenu.MenuItem onClick={() => setIsEditorOpen(true)}>
            <span className="flex items-center gap-2">
              <Pencil className="size-3.5 flex-shrink-0" />
              <span className="flex-1">{t("project_settings.custom_fields.edit_options")}</span>
            </span>
          </CustomMenu.MenuItem>
        )}
      </CustomMenu>
    );
  } else if (field.field_type === "people") {
    const ids = Array.isArray(value) ? value : [];
    inner = (
      <MemberDropdown
        projectId={projectId}
        value={ids}
        onChange={(next: string[]) => commit(next.length > 0 ? next : null)}
        multiple
        disabled={isReadOnly}
        buttonVariant={ids.length > 0 ? "transparent-with-text" : "border-with-text"}
        buttonClassName="text-13"
        placeholder={field.name}
        showTooltip={false}
        tooltipContent=""
      />
    );
  } else {
    // multi_select — colored-chip toggle popover; stays open across toggles
    // (single_select uses the same inline CustomMenu, single-value).
    const ids = Array.isArray(value) ? value : [];
    const selected = ids.map((id) => optionById(id)).filter((o): o is TWorkItemFieldOption => Boolean(o));
    inner = (
      <CustomMenu
        closeOnSelect={false}
        disabled={isReadOnly}
        placement="bottom-start"
        optionsClassName="z-20 min-w-[12rem]"
        customButton={
          <div className="flex min-h-[1.75rem] w-full flex-wrap items-center gap-1 rounded border border-strong px-1.5 py-0.5">
            {selected.length === 0 ? (
              <span className="text-13 text-placeholder">—</span>
            ) : (
              selected.map((opt) => (
                <span
                  key={opt.id}
                  className={cn(LABEL_PILL_CLASS, "max-w-full overflow-hidden")}
                  style={labelPillStyle(opt.color)}
                >
                  <span className="truncate">{opt.name}</span>
                </span>
              ))
            )}
          </div>
        }
      >
        <CustomMenu.MenuItem onClick={() => commit(null)}>
          <span className="flex items-center gap-2">
            <span className="flex-1 text-placeholder">—</span>
            {selected.length === 0 && <Check className="size-3.5 flex-shrink-0" />}
          </span>
        </CustomMenu.MenuItem>
        {activeOptions.length === 0 && <span className="px-2 py-1 text-13 text-placeholder">—</span>}
        {activeOptions.map((opt) => {
          const isSelected = ids.includes(opt.id);
          return (
            <CustomMenu.MenuItem
              key={opt.id}
              onClick={() => {
                const next = isSelected ? ids.filter((x) => x !== opt.id) : [...ids, opt.id];
                commit(next.length > 0 ? next : null);
              }}
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
                <span className="flex-1 truncate">{opt.name}</span>
                {isSelected && <Check className="size-3.5 flex-shrink-0" />}
              </span>
            </CustomMenu.MenuItem>
          );
        })}
        {canManageFields && (
          <CustomMenu.MenuItem onClick={() => setIsEditorOpen(true)}>
            <span className="flex items-center gap-2">
              <Pencil className="size-3.5 flex-shrink-0" />
              <span className="flex-1">{t("project_settings.custom_fields.edit_options")}</span>
            </span>
          </CustomMenu.MenuItem>
        )}
      </CustomMenu>
    );
  }

  // The list row is an <a href> ControlLink (opens the issue peek). Stop
  // propagation AND preventDefault, otherwise clicking a dropdown option
  // also triggers the row's link/peek and the selection is lost ("opens
  // but can't change"). preventDefault on *click* is safe for text/number
  // inputs — their focus happens on mousedown, not click.
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="w-full min-w-0"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onFocus={(e) => e.stopPropagation()}
    >
      {inner}
      <WorkItemFieldEditorModal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} fieldToUpdate={field} />
    </div>
  );
});
