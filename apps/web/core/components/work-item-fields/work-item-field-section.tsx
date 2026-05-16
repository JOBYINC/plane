/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Pencil, Trash2, Plus } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { TWorkItemField } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { useUserPermissions } from "@/hooks/store/user";
// local
import { FieldTypeIcon } from "./field-type-icon";
import { WorkItemFieldCell } from "./work-item-field-cell";
import { DeleteFieldModal } from "./delete-field-modal";
import { WorkItemFieldEditorModal } from "./work-item-field-editor-modal";

interface WorkItemFieldSectionProps {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isReadOnly?: boolean;
}

/**
 * Custom-fields block for the issue detail / peek right-rail (design §8 /
 * §10 step 8). Isolated and store-backed; reuses WorkItemFieldCell.
 *
 * Project admins get full in-context field management here (add / edit /
 * archive) via WorkItemFieldEditorModal — no trip to the settings page
 * (Asana parity, design §7 full-inline). `isReadOnly` (peek `disabled`)
 * gates value editing; schema management is gated separately on the
 * project-ADMIN permission (design §12).
 */
export const WorkItemFieldSection = observer(function WorkItemFieldSection(props: WorkItemFieldSectionProps) {
  const { workspaceSlug, projectId, issueId, isReadOnly } = props;
  const { getProjectFields, fetchProjectFields, fetchProjectFieldValues, deleteField } = useWorkItemField();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [fieldToEdit, setFieldToEdit] = useState<TWorkItemField | undefined>(undefined);
  const [fieldToDelete, setFieldToDelete] = useState<TWorkItemField | undefined>(undefined);

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    fetchProjectFields(workspaceSlug, projectId).catch((e) =>
      console.error("[custom-fields] peek fetchProjectFields failed", e)
    );
    fetchProjectFieldValues(workspaceSlug, projectId, [issueId]).catch((e) =>
      console.error("[custom-fields] peek fetchProjectFieldValues failed", e)
    );
  }, [workspaceSlug, projectId, issueId, fetchProjectFields, fetchProjectFieldValues]);

  const canManageFields = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const fields = (getProjectFields(projectId) ?? []).filter((f) => f.is_active);

  // Nothing to render and no power to add anything → stay invisible.
  if (fields.length === 0 && !canManageFields) return null;

  const openCreate = () => {
    setFieldToEdit(undefined);
    setIsEditorOpen(true);
  };

  const openEdit = (field: TWorkItemField) => {
    setFieldToEdit(field);
    setIsEditorOpen(true);
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <span className="text-13 font-medium text-secondary">{t("project_settings.custom_fields.heading")}</span>

      {fields.length > 0 && (
        <div className="flex flex-col gap-2">
          {fields.map((field) => (
            <div key={field.id} className="group flex items-start gap-2">
              <div className="flex w-2/5 flex-shrink-0 items-center gap-1.5 pt-1">
                <FieldTypeIcon type={field.field_type} className="size-3 flex-shrink-0 text-tertiary" />
                <span className="truncate text-13 text-tertiary">{field.name}</span>
                {field.is_required && <span className="text-12 text-danger-primary">*</span>}
              </div>
              <div className="min-w-0 flex-1">
                <WorkItemFieldCell field={field} issueId={issueId} projectId={projectId} isReadOnly={isReadOnly} />
              </div>
              {canManageFields && (
                <CustomMenu
                  ellipsis
                  placement="bottom-end"
                  buttonClassName="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  optionsClassName="z-20"
                >
                  <CustomMenu.MenuItem onClick={() => openEdit(field)}>
                    <span className="flex items-center gap-2">
                      <Pencil className="size-3.5" />
                      {t("project_settings.custom_fields.edit_field")}
                    </span>
                  </CustomMenu.MenuItem>
                  <CustomMenu.MenuItem onClick={() => setFieldToDelete(field)}>
                    <span className="flex items-center gap-2">
                      <Trash2 className="size-3.5" />
                      {t("project_settings.custom_fields.delete_field")}
                    </span>
                  </CustomMenu.MenuItem>
                </CustomMenu>
              )}
            </div>
          ))}
        </div>
      )}

      {canManageFields && (
        <div className="w-fit">
          <Button
            variant="link"
            size="sm"
            prependIcon={<Plus className="size-3.5" />}
            onClick={openCreate}
            className="px-0"
          >
            {t("project_settings.custom_fields.add_field")}
          </Button>
        </div>
      )}

      <WorkItemFieldEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        fieldToUpdate={fieldToEdit}
      />
      <DeleteFieldModal
        isOpen={!!fieldToDelete}
        handleClose={() => setFieldToDelete(undefined)}
        handleSubmit={async () => {
          if (fieldToDelete) await deleteField(workspaceSlug, projectId, fieldToDelete.id);
        }}
      />
    </div>
  );
});
