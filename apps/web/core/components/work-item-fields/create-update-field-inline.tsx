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
import { getRandomLabelColor, LABEL_COLOR_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField, TWorkItemFieldType } from "@plane/types";
import { WORK_ITEM_FIELD_OPTION_TYPES } from "@plane/types";
import { CustomSelect, Input } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
// local
import { FieldOptionEditor, OptionColorSwatch } from "./field-option-editor";
import { FieldTypeIcon } from "./field-type-icon";

const FIELD_TYPES: TWorkItemFieldType[] = ["text", "number", "date", "single_select", "multi_select", "people"];

const isOptionType = (t: TWorkItemFieldType) => WORK_ITEM_FIELD_OPTION_TYPES.includes(t);

type DraftOption = { key: string; name: string; color: string };

const makeDefaultOptions = (): DraftOption[] => [
  { key: crypto.randomUUID(), name: "Option 1", color: LABEL_COLOR_OPTIONS[3] },
  { key: crypto.randomUUID(), name: "Option 2", color: LABEL_COLOR_OPTIONS[4] },
];

interface CreateUpdateFieldInlineProps {
  fieldToUpdate?: TWorkItemField;
  onClose: () => void;
  /**
   * Drop the settings-card chrome (border / bg / padding) so the form can sit
   * inside a modal that supplies its own chrome. Default false keeps the
   * standalone settings-page look untouched.
   */
  embedded?: boolean;
  /** Optional: notified with the created field (legacy hook; modal just closes). */
  onCreated?: (field: TWorkItemField) => void;
}

/**
 * Asana-parity "Add / Edit field" form (design §7 full-inline). Two-column
 * title + typed icon-dropdown, collapsible description, and — for
 * single/multi-select — an inline Options editor. Create-mode options are
 * collected locally and created in one "Create field" action; edit-mode
 * options use the live FieldOptionEditor. Used both in the in-context modal
 * and (un-embedded, card-chromed) on the project settings page.
 */
export const CreateUpdateFieldInline = observer(function CreateUpdateFieldInline(props: CreateUpdateFieldInlineProps) {
  const { fieldToUpdate, onClose, embedded = false, onCreated } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { createField, updateField, createOption, fetchProjectFields } = useWorkItemField();
  // i18n
  const { t } = useTranslation();
  // form state
  const [name, setName] = useState(fieldToUpdate?.name ?? "");
  const [fieldType, setFieldType] = useState<TWorkItemFieldType>(fieldToUpdate?.field_type ?? "text");
  const [description, setDescription] = useState(fieldToUpdate?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(fieldToUpdate?.description));
  const [options, setOptions] = useState<DraftOption[]>(makeDefaultOptions);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isUpdating = Boolean(fieldToUpdate?.id);
  const ws = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";
  const showOptions = isOptionType(fieldType);
  // Edit mode = live option CRUD; create mode = local drafts created on submit.
  const showLiveOptions = isUpdating && fieldToUpdate && isOptionType(fieldToUpdate.field_type);

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
    if (!isUpdating && showOptions && options.every((o) => !o.name.trim())) {
      setNameError(null);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.option_name_required"),
      });
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
        await updateField(ws, pid, fieldToUpdate.id, { name: name.trim(), description });
        onClose();
      } else {
        const created = await createField(ws, pid, {
          name: name.trim(),
          field_type: fieldType,
          description,
        });
        if (isOptionType(fieldType)) {
          // Sequential on purpose: the store's createOption reads
          // fieldMap[id].options on each call, so parallel creation would
          // race and drop options. Order also = option sort order.
          for (const opt of options) {
            const optName = opt.name.trim();
            if (!optName) continue;
            try {
              // eslint-disable-next-line no-await-in-loop
              await createOption(ws, pid, created.id, { name: optName, color: opt.color });
            } catch {
              setToast({
                type: TOAST_TYPE.ERROR,
                title: "Error!",
                message: t("project_settings.custom_fields.toast.option_error"),
              });
            }
          }
        }
        // Re-pull the canonical field (with its options + server shapes) so
        // the list column / peek cell renders an openable, populated picker
        // — don't rely on the client-merged create responses alone.
        await fetchProjectFields(ws, pid).catch(() => {});
        onCreated?.(created);
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
    <div
      className={
        embedded
          ? "flex w-full flex-col gap-5"
          : "border-default flex w-full flex-col gap-5 rounded-md border bg-surface-1 p-4"
      }
    >
      {/* Field title + Field type */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-13 font-medium text-secondary">
            {t("project_settings.custom_fields.field_title_label")}
            <span className="ml-0.5 text-danger-primary">*</span>
          </span>
          <Input
            type="text"
            value={name}
            hasError={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("project_settings.custom_fields.field_title_placeholder")}
            className="w-full"
          />
          {nameError && <p className="text-13 text-danger-primary">{nameError}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-13 font-medium text-secondary">
            {t("project_settings.custom_fields.field_type_label")}
          </span>
          <CustomSelect
            value={fieldType}
            disabled={isUpdating}
            onChange={(val: TWorkItemFieldType) => setFieldType(val)}
            optionsClassName="z-30 min-w-[12rem]"
            buttonClassName="w-full justify-between rounded-md border border-default px-3 py-1.5 text-14 disabled:opacity-60"
            label={
              <span className="flex items-center gap-2">
                <FieldTypeIcon type={fieldType} className="size-4 text-tertiary" />
                {t(`project_settings.custom_fields.types.${fieldType}`)}
              </span>
            }
          >
            {FIELD_TYPES.map((ty) => (
              <CustomSelect.Option key={ty} value={ty}>
                <span className="flex items-center gap-2">
                  <FieldTypeIcon type={ty} className="size-4 text-tertiary" />
                  {t(`project_settings.custom_fields.types.${ty}`)}
                </span>
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        </div>
      </div>

      {/* Description (collapsed until requested, Asana-style) */}
      {showDescription ? (
        <div className="flex flex-col gap-1.5">
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
      ) : (
        <button
          type="button"
          onClick={() => setShowDescription(true)}
          className="flex w-fit items-center gap-1.5 text-13 text-tertiary hover:text-secondary"
        >
          <Plus className="size-3.5" />
          {t("project_settings.custom_fields.add_description")}
        </button>
      )}

      {/* Options */}
      {showOptions &&
        (showLiveOptions && fieldToUpdate ? (
          <FieldOptionEditor field={fieldToUpdate} />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-13 font-medium text-secondary">
              {t("project_settings.custom_fields.options_label")}
              <span className="ml-0.5 text-danger-primary">*</span>
            </span>
            <div className="flex flex-col">
              {options.map((opt) => (
                <div key={opt.key} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-surface-2">
                  <OptionColorSwatch
                    color={opt.color}
                    onChange={(c) =>
                      setOptions((prev) => prev.map((o) => (o.key === opt.key ? { ...o, color: c } : o)))
                    }
                  />
                  <input
                    type="text"
                    value={opt.name}
                    aria-label={opt.name}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((o) => (o.key === opt.key ? { ...o, name: e.target.value } : o)))
                    }
                    className="min-w-0 flex-1 bg-transparent text-14 text-primary outline-none"
                  />
                  {options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => prev.filter((o) => o.key !== opt.key))}
                      className="flex-shrink-0 text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger-primary"
                      aria-label={t("project_settings.custom_fields.archived")}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setOptions((prev) => [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    name: `${t("project_settings.custom_fields.option_default")} ${prev.length + 1}`,
                    color: getRandomLabelColor(),
                  },
                ])
              }
              className="flex w-fit items-center gap-1.5 px-1 text-13 text-tertiary hover:text-secondary"
            >
              <Plus className="size-3.5" />
              {t("project_settings.custom_fields.add_an_option")}
            </button>
          </div>
        ))}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-subtle pt-4">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="primary" onClick={onSubmit} loading={isSubmitting}>
          {isUpdating
            ? t("project_settings.custom_fields.save_changes")
            : t("project_settings.custom_fields.create_field")}
        </Button>
      </div>
    </div>
  );
});
