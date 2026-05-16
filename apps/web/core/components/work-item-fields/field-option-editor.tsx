/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { Fragment, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronDown, Plus, X } from "lucide-react";
import { Popover, Transition } from "@headlessui/react";
import { TwitterPicker } from "react-color";
// plane imports
import { getRandomLabelColor, LABEL_COLOR_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkItemField } from "@plane/types";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";

/**
 * Asana-style colour swatch: a filled circle with a chevron that opens a
 * palette popover (Plane's own label-colour pattern — TwitterPicker +
 * LABEL_COLOR_OPTIONS). Reused by the create-mode local option rows and the
 * edit-mode live option rows.
 */
interface OptionColorSwatchProps {
  color: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function OptionColorSwatch({ color, onChange, disabled }: OptionColorSwatchProps) {
  return (
    <Popover className="relative flex flex-shrink-0 items-center">
      <Popover.Button
        type="button"
        disabled={disabled}
        className="focus:ring-primary/40 flex items-center justify-center rounded-full outline-none focus:ring-2 disabled:opacity-60"
      >
        <span className="flex size-5 items-center justify-center rounded-full" style={{ backgroundColor: color }}>
          <ChevronDown className="size-3 text-white/90" />
        </span>
      </Popover.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Popover.Panel className="absolute top-full left-0 z-30 mt-1" data-prevent-outside-click>
          {({ close }) => (
            <TwitterPicker
              colors={LABEL_COLOR_OPTIONS}
              color={color}
              triangle="hide"
              onChange={(c) => {
                onChange(c.hex);
                close();
              }}
            />
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  );
}

interface FieldOptionEditorProps {
  field: TWorkItemField;
  disabled?: boolean;
}

/**
 * Live (edit-mode) option editor: every change hits the option CRUD endpoints
 * immediately. Asana-style rows — colour swatch, borderless inline name,
 * remove-on-hover, and a "+ Add an option" affordance that drops in a new
 * inline-editable row.
 */
export const FieldOptionEditor = observer(function FieldOptionEditor(props: FieldOptionEditorProps) {
  const { field, disabled } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { createOption, updateOption, deleteOption } = useWorkItemField();
  // i18n
  const { t } = useTranslation();
  // local state
  const [isAdding, setIsAdding] = useState(false);

  const ws = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";
  const activeOptions = field.options.filter((opt) => opt.is_active);

  const optionError = () =>
    setToast({
      type: TOAST_TYPE.ERROR,
      title: "Error!",
      message: t("project_settings.custom_fields.toast.option_error"),
    });

  const onAdd = async () => {
    setIsAdding(true);
    try {
      await createOption(ws, pid, field.id, {
        name: `${t("project_settings.custom_fields.option_default")} ${activeOptions.length + 1}`,
        color: getRandomLabelColor(),
      });
    } catch {
      optionError();
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
      optionError();
    }
  };

  const onRecolor = async (optionId: string, color: string) => {
    try {
      await updateOption(ws, pid, field.id, optionId, { color });
    } catch {
      optionError();
    }
  };

  const onArchive = async (optionId: string) => {
    try {
      await deleteOption(ws, pid, field.id, optionId);
    } catch {
      optionError();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-13 font-medium text-secondary">
        {t("project_settings.custom_fields.options_label")}
        <span className="ml-0.5 text-danger-primary">*</span>
      </span>
      <div className="flex flex-col">
        {activeOptions.map((option) => (
          <div key={option.id} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-surface-2">
            <OptionColorSwatch color={option.color} disabled={disabled} onChange={(c) => onRecolor(option.id, c)} />
            <input
              type="text"
              defaultValue={option.name}
              disabled={disabled}
              aria-label={option.name}
              onBlur={(e) => {
                if (e.target.value.trim() !== option.name) onRename(option.id, e.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-14 text-primary outline-none disabled:opacity-60"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onArchive(option.id)}
                className="flex-shrink-0 text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger-primary"
                aria-label={t("project_settings.custom_fields.archived")}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onAdd}
          disabled={isAdding}
          className="flex w-fit items-center gap-1.5 px-1 text-13 text-tertiary hover:text-secondary disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          {t("project_settings.custom_fields.add_an_option")}
        </button>
      )}
    </div>
  );
});
