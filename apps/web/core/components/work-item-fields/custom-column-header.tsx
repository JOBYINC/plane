/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Pencil, Archive, Plus } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField } from "@plane/types";
import { CustomMenu, Tooltip } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { useUserPermissions } from "@/hooks/store/user";
// local
import { customColumnKeyToFieldId } from "@/components/issues/issue-layouts/list/columns/list-columns";
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
}

/**
 * One custom-field column header. Non-admins see exactly the previous plain
 * label (zero visual change); admins get a click-to-open Edit / Archive menu.
 */
export const CustomColumnHeaderCell = observer(function CustomColumnHeaderCell(props: CustomColumnHeaderCellProps) {
  const { columnKey, label } = props;
  const { workspaceSlug, projectId } = useParams();
  const { getFieldById, deleteField } = useWorkItemField();
  const { t } = useTranslation();
  const canManageFields = useCanManageFields();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const fieldId = customColumnKeyToFieldId(columnKey);
  const field: TWorkItemField | null = getFieldById(fieldId);

  if (!canManageFields || !field) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{label}</span>
      </div>
    );
  }

  const onArchive = async () => {
    try {
      await deleteField(workspaceSlug?.toString() ?? "", projectId?.toString() ?? "", field.id);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.toast.update_error"),
      });
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 truncate">
      <CustomMenu
        placement="bottom-start"
        customButton={
          <span className="truncate rounded px-1 py-0.5 hover:bg-surface-2" title={label}>
            {label}
          </span>
        }
        optionsClassName="z-20"
      >
        <CustomMenu.MenuItem onClick={() => setIsEditorOpen(true)}>
          <span className="flex items-center gap-2">
            <Pencil className="size-3.5" />
            {t("project_settings.custom_fields.edit_field")}
          </span>
        </CustomMenu.MenuItem>
        <CustomMenu.MenuItem onClick={onArchive}>
          <span className="flex items-center gap-2">
            <Archive className="size-3.5" />
            {t("project_settings.custom_fields.archive_field")}
          </span>
        </CustomMenu.MenuItem>
      </CustomMenu>
      <WorkItemFieldEditorModal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} fieldToUpdate={field} />
    </div>
  );
});

/**
 * Trailing "+ add field" affordance. Occupies the header's existing 56px
 * actions track (replaces the old empty `aria-hidden` div), so the grid
 * template is untouched and row alignment is unaffected. Non-admins get
 * the same empty slot as before.
 */
export const AddCustomFieldHeaderButton = observer(function AddCustomFieldHeaderButton() {
  const { t } = useTranslation();
  const canManageFields = useCanManageFields();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  if (!canManageFields) return <div aria-hidden />;

  return (
    <div className="flex items-center justify-center">
      <Tooltip tooltipContent={t("project_settings.custom_fields.add_field")}>
        <button
          type="button"
          onClick={() => setIsEditorOpen(true)}
          aria-label={t("project_settings.custom_fields.add_field")}
          className="rounded p-1 text-tertiary hover:bg-surface-2 hover:text-secondary"
        >
          <Plus className="size-4" />
        </button>
      </Tooltip>
      <WorkItemFieldEditorModal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} />
    </div>
  );
});
