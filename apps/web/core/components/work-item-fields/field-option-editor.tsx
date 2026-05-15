/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus, X } from "lucide-react";
// plane imports
import { getRandomLabelColor } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField } from "@plane/types";
import { Input } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";

interface FieldOptionEditorProps {
  field: TWorkItemField;
  disabled?: boolean;
}

export const FieldOptionEditor = observer(function FieldOptionEditor(props: FieldOptionEditorProps) {
  const { field, disabled } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { createOption, updateOption, deleteOption } = useWorkItemField();
  // i18n
  const { t } = useTranslation();
  // local state
  const [newOptionName, setNewOptionName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const ws = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";
  const activeOptions = field.options.filter((opt) => opt.is_active);

  const onAdd = async () => {
    const name = newOptionName.trim();
    if (!name) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.option_name_required"),
      });
      return;
    }
    setIsAdding(true);
    try {
      await createOption(ws, pid, field.id, { name, color: getRandomLabelColor() });
      setNewOptionName("");
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.toast.option_error"),
      });
    } finally {
      setIsAdding(false);
    }
  };

  const onRename = async (optionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await updateOption(ws, pid, field.id, optionId, { name: trimmed });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.toast.option_error"),
      });
    }
  };

  const onArchive = async (optionId: string) => {
    try {
      await deleteOption(ws, pid, field.id, optionId);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.toast.option_error"),
      });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-13 font-medium text-secondary">{t("project_settings.custom_fields.options_label")}</span>
      <div className="flex flex-col gap-1.5">
        {activeOptions.map((option) => (
          <div key={option.id} className="flex items-center gap-2">
            <span className="size-3 flex-shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
            <Input
              type="text"
              defaultValue={option.name}
              disabled={disabled}
              onBlur={(e) => {
                if (e.target.value.trim() !== option.name) onRename(option.id, e.target.value);
              }}
              className="flex-1"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onArchive(option.id)}
                className="flex-shrink-0 text-tertiary hover:text-danger-primary"
                aria-label={t("project_settings.custom_fields.archived")}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newOptionName}
            onChange={(e) => setNewOptionName(e.target.value)}
            placeholder={t("project_settings.custom_fields.option_placeholder")}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onAdd}
            loading={isAdding}
            prependIcon={<Plus className="size-3.5" />}
          >
            {t("project_settings.custom_fields.add_option")}
          </Button>
        </div>
      )}
    </div>
  );
});
