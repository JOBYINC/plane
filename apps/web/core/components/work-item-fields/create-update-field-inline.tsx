/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField, TWorkItemFieldType } from "@plane/types";
import { WORK_ITEM_FIELD_OPTION_TYPES } from "@plane/types";
import { Input } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
// local
import { FieldOptionEditor } from "./field-option-editor";

const FIELD_TYPES: TWorkItemFieldType[] = ["text", "number", "date", "single_select", "multi_select", "people"];

interface CreateUpdateFieldInlineProps {
  fieldToUpdate?: TWorkItemField;
  onClose: () => void;
}

export const CreateUpdateFieldInline = observer(function CreateUpdateFieldInline(props: CreateUpdateFieldInlineProps) {
  const { fieldToUpdate, onClose } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { createField, updateField } = useWorkItemField();
  // i18n
  const { t } = useTranslation();
  // form state
  const [name, setName] = useState(fieldToUpdate?.name ?? "");
  const [fieldType, setFieldType] = useState<TWorkItemFieldType>(fieldToUpdate?.field_type ?? "text");
  const [isRequired, setIsRequired] = useState(fieldToUpdate?.is_required ?? false);
  const [description, setDescription] = useState(fieldToUpdate?.description ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isUpdating = Boolean(fieldToUpdate?.id);
  const ws = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";
  const showOptions =
    isUpdating && fieldToUpdate ? WORK_ITEM_FIELD_OPTION_TYPES.includes(fieldToUpdate.field_type) : false;

  const validate = (): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("project_settings.custom_fields.name_required"));
      return false;
    }
    if (trimmed.length > 255) {
      setNameError(t("project_settings.custom_fields.name_max_char"));
      return false;
    }
    setNameError(null);
    return true;
  };

  const onSubmit = async () => {
    if (isSubmitting || !validate()) return;
    setIsSubmitting(true);
    try {
      if (isUpdating && fieldToUpdate) {
        await updateField(ws, pid, fieldToUpdate.id, {
          name: name.trim(),
          is_required: isRequired,
          description,
        });
      } else {
        await createField(ws, pid, {
          name: name.trim(),
          field_type: fieldType,
          is_required: isRequired,
          description,
        });
        onClose();
      }
    } catch (error) {
      const data = (error ?? {}) as { name?: string[]; error?: string };
      const nameExists = Array.isArray(data.name) || data.error?.includes("already exists");
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: nameExists
          ? t("project_settings.custom_fields.toast.name_exists")
          : isUpdating
            ? t("project_settings.custom_fields.toast.update_error")
            : t("project_settings.custom_fields.toast.create_error"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border-default flex w-full flex-col gap-3 rounded-md border bg-surface-1 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-13 font-medium text-secondary">{t("project_settings.custom_fields.name_label")}</span>
        <Input
          type="text"
          value={name}
          hasError={Boolean(nameError)}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("project_settings.custom_fields.name_placeholder")}
          className="w-full"
        />
        {nameError && <p className="text-13 text-danger-primary">{nameError}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-13 font-medium text-secondary">{t("project_settings.custom_fields.type_label")}</span>
        <select
          aria-label={t("project_settings.custom_fields.type_label")}
          value={fieldType}
          disabled={isUpdating}
          onChange={(e) => setFieldType(e.target.value as TWorkItemFieldType)}
          className="border-default w-full rounded-md border bg-surface-1 px-3 py-1.5 text-14 disabled:opacity-60"
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`project_settings.custom_fields.types.${type}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-13 font-medium text-secondary">
          {t("project_settings.custom_fields.description_label")}
        </span>
        <Input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("project_settings.custom_fields.description_placeholder")}
          className="w-full"
        />
      </div>

      <label className="flex w-fit items-center gap-2 text-14 text-secondary">
        <input
          type="checkbox"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
          className="border-default rounded"
        />
        {t("project_settings.custom_fields.required_label")}
      </label>

      {showOptions && fieldToUpdate && <FieldOptionEditor field={fieldToUpdate} />}

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="primary" onClick={onSubmit} loading={isSubmitting}>
          {isUpdating ? t("update") : t("add")}
        </Button>
      </div>
    </div>
  );
});
