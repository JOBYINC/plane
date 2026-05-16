/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Pencil, Archive } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField } from "@plane/types";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
// local
import { CreateUpdateFieldInline } from "./create-update-field-inline";
import { FieldTypeIcon } from "./field-type-icon";

interface FieldListItemProps {
  field: TWorkItemField;
  isEditable: boolean;
}

export const FieldListItem = observer(function FieldListItem(props: FieldListItemProps) {
  const { field, isEditable } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { deleteField } = useWorkItemField();
  // i18n
  const { t } = useTranslation();
  // local state
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return <CreateUpdateFieldInline fieldToUpdate={field} onClose={() => setIsEditing(false)} />;
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
    <div className="border-default flex items-center justify-between gap-3 rounded-md border bg-surface-1 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-7 flex-shrink-0 items-center justify-center rounded bg-surface-2 text-tertiary">
          <FieldTypeIcon type={field.field_type} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-14 font-medium text-primary">{field.name}</span>
            {field.is_required && <span className="text-12 text-danger-primary">*</span>}
            {!field.is_active && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-11 text-tertiary">
                {t("project_settings.custom_fields.archived")}
              </span>
            )}
          </div>
          <span className="text-12 text-tertiary">{t(`project_settings.custom_fields.types.${field.field_type}`)}</span>
        </div>
      </div>
      {isEditable && field.is_active && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded p-1.5 text-tertiary hover:bg-surface-2 hover:text-secondary"
            aria-label={t("project_settings.custom_fields.edit_field")}
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="rounded p-1.5 text-tertiary hover:bg-surface-2 hover:text-danger-primary"
            aria-label={t("project_settings.custom_fields.archive_field")}
          >
            <Archive className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
});
