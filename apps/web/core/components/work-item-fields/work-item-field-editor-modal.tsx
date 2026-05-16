/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TWorkItemField } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// local
import { CreateUpdateFieldInline } from "./create-update-field-inline";

interface WorkItemFieldEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Field to edit. Omit for create mode. */
  fieldToUpdate?: TWorkItemField;
}

/**
 * In-context create/edit surface for a custom field (Asana parity, design §7
 * full-inline). Field management never leaves the work-item context — no trip
 * to the project settings page. Select-type options are collected inline in
 * the form and created with the field in one action.
 */
export const WorkItemFieldEditorModal = observer(function WorkItemFieldEditorModal(
  props: WorkItemFieldEditorModalProps
) {
  const { isOpen, onClose, fieldToUpdate } = props;
  const { t } = useTranslation();

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={onClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.XXL}
      className="p-5"
    >
      {/* Portaled to <body> (Headless UI Dialog) — i.e. outside the issue
          peek's ref. data-prevent-outside-click is Plane's built-in opt-out
          (use-peek-overview-outside-click) so a click inside this modal does
          NOT close the underlying peek (which would unmount this modal). */}
      <div data-prevent-outside-click>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary">
            {fieldToUpdate
              ? t("project_settings.custom_fields.edit_field")
              : t("project_settings.custom_fields.add_field_title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-tertiary hover:bg-surface-2 hover:text-secondary"
            aria-label={t("cancel")}
          >
            <X className="size-4" />
          </button>
        </div>
        <CreateUpdateFieldInline embedded fieldToUpdate={fieldToUpdate} onClose={onClose} />
      </div>
    </ModalCore>
  );
});
