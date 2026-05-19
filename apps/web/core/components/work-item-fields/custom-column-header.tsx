/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Pencil, Trash2, Plus, Eye, EyeOff, ChevronDownIcon } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkItemField } from "@plane/types";
import { CustomMenu, Tooltip } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { useUserPermissions } from "@/hooks/store/user";
// local
import { ColumnResizeHandle } from "@/components/issues/issue-layouts/list/columns/column-resize-handle";
import {
  customColumnKeyToFieldId,
  type TCustomListColumn,
} from "@/components/issues/issue-layouts/list/columns/list-columns";
import { DeleteFieldModal } from "./delete-field-modal";
import { WorkItemFieldEditorModal } from "./work-item-field-editor-modal";

/**
 * In-context custom-field management from the list column-header (design §7
 * full-inline / Asana parity). Kept in its own file so the PR2-shared
 * `list-header-row.tsx` only swaps a label `<div>` for these components —
 * a trivial, additive diff that stays easy to re-resolve on a PR2 rebase.
 */

function useCanManageFields(): boolean {
  const { allowPermissions } = useUserPermissions();
  return allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
}

interface CustomColumnHeaderCellProps {
  columnKey: string;
  label: string;
  // 4c: per-column resize (parity with built-in columns). currentWidth is a
  // fallback — the handle measures the rendered cell at pointer-down.
  currentWidth: number;
  minWidth: number;
  onCommitWidth?: (newWidth: number) => void;
  // B2: hide this custom column from the current user's list. Available to
  // everyone (per-user view pref), unlike Edit/Delete which are admin-only.
  onHide?: () => void;
}

/**
 * One custom-field column header. Everyone with a `onHide` handler gets a
 * menu (so any user can hide the column); admins additionally get Edit /
 * Delete. With no menu actions at all, it falls back to the plain label
 * (zero visual change — e.g. read-only views with no onHide).
 */
export const CustomColumnHeaderCell = observer(function CustomColumnHeaderCell(props: CustomColumnHeaderCellProps) {
  const { columnKey, label, currentWidth, minWidth, onCommitWidth, onHide } = props;
  const { workspaceSlug, projectId } = useParams();
  const { getFieldById, deleteField } = useWorkItemField();
  const { t } = useTranslation();
  const canManageFields = useCanManageFields();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const fieldId = customColumnKeyToFieldId(columnKey);
  const field: TWorkItemField | null = getFieldById(fieldId);

  // Edit/Delete need the resolved field + admin; Hide only needs the column key.
  const canManageThisField = canManageFields && !!field;
  const hasMenu = canManageThisField || !!onHide;

  const resizeHandle = onCommitWidth ? (
    <ColumnResizeHandle currentWidth={currentWidth} minWidth={minWidth} onCommit={onCommitWidth} />
  ) : null;

  if (!hasMenu) {
    return (
      <div className="relative flex w-full min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{label}</span>
        {resizeHandle}
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 items-center">
      <CustomMenu
        customButtonClassName="clickable !w-full"
        customButtonTabIndex={-1}
        className="!w-full"
        placement="bottom-start"
        closeOnSelect
        customButton={
          <div
            className="flex w-full cursor-pointer items-center justify-between gap-1.5 text-secondary hover:text-primary"
            title={label}
          >
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              <span className="truncate">{label}</span>
            </div>
            <div className="ml-1 flex shrink-0 items-center">
              <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
            </div>
          </div>
        }
        optionsClassName="z-20"
      >
        {canManageThisField && (
          <CustomMenu.MenuItem onClick={() => setIsEditorOpen(true)}>
            <span className="flex items-center gap-2">
              <Pencil className="size-3.5" />
              {t("project_settings.custom_fields.edit_field")}
            </span>
          </CustomMenu.MenuItem>
        )}
        {onHide && (
          <CustomMenu.MenuItem onClick={onHide}>
            <span className="flex items-center gap-2">
              <EyeOff className="size-3.5" />
              {t("common.actions.hide_field")}
            </span>
          </CustomMenu.MenuItem>
        )}
        {canManageThisField && (
          <CustomMenu.MenuItem onClick={() => setIsDeleteOpen(true)}>
            <span className="flex items-center gap-2">
              <Trash2 className="size-3.5" />
              {t("project_settings.custom_fields.delete_field")}
            </span>
          </CustomMenu.MenuItem>
        )}
      </CustomMenu>
      {canManageThisField && (
        <>
          <WorkItemFieldEditorModal
            isOpen={isEditorOpen}
            onClose={() => setIsEditorOpen(false)}
            fieldToUpdate={field}
          />
          <DeleteFieldModal
            isOpen={isDeleteOpen}
            handleClose={() => setIsDeleteOpen(false)}
            handleSubmit={async () => {
              await deleteField(workspaceSlug?.toString() ?? "", projectId?.toString() ?? "", field.id);
            }}
          />
        </>
      )}
      {resizeHandle}
    </div>
  );
});

interface AddCustomFieldHeaderButtonProps {
  // B2: custom fields currently hidden from this user's list. Listed here so
  // hide is reversible from the list UI (custom fields have no entry in
  // Plane's Display dropdown).
  hiddenColumns: TCustomListColumn[];
  onShow?: (key: string) => void;
}

/**
 * Trailing affordance in the header's existing 56px actions track (so the
 * grid template + row alignment are unaffected). Admins can add a new field;
 * any user can re-show a hidden custom column. Non-admins with nothing hidden
 * get the same empty slot as before (zero change).
 */
export const AddCustomFieldHeaderButton = observer(function AddCustomFieldHeaderButton(
  props: AddCustomFieldHeaderButtonProps
) {
  const { hiddenColumns, onShow } = props;
  const { t } = useTranslation();
  const canManageFields = useCanManageFields();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const hasHidden = hiddenColumns.length > 0 && !!onShow;
  if (!canManageFields && !hasHidden) return <div aria-hidden />;

  return (
    <div className="flex items-center justify-center">
      <CustomMenu
        placement="bottom-end"
        optionsClassName="z-20"
        customButton={
          <Tooltip tooltipContent={t("project_settings.custom_fields.add_field")}>
            <span
              aria-label={t("project_settings.custom_fields.add_field")}
              className="flex rounded p-1 text-tertiary hover:bg-surface-2 hover:text-secondary"
            >
              <Plus className="size-4" />
            </span>
          </Tooltip>
        }
      >
        {canManageFields && (
          <CustomMenu.MenuItem onClick={() => setIsEditorOpen(true)}>
            <span className="flex items-center gap-2">
              <Plus className="size-3.5" />
              {t("project_settings.custom_fields.add_field")}
            </span>
          </CustomMenu.MenuItem>
        )}
        {hasHidden &&
          hiddenColumns.map((c) => (
            <CustomMenu.MenuItem key={c.key} onClick={() => onShow?.(c.key)}>
              <span className="flex items-center gap-2">
                <Eye className="size-3.5" />
                {t("common.actions.show_field")}: {c.label}
              </span>
            </CustomMenu.MenuItem>
          ))}
      </CustomMenu>
      {canManageFields && <WorkItemFieldEditorModal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} />}
    </div>
  );
});
