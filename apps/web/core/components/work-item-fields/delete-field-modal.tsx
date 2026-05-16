/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";

interface IDeleteFieldModal {
  isOpen: boolean;
  handleClose: () => void;
  handleSubmit: () => Promise<void>;
}

/**
 * Confirmation dialog for deleting a custom field. The backend soft-archives
 * (is_active=false) but the field + all its values become permanently
 * inaccessible from the UI (no restore entry), so this is a destructive,
 * irreversible action. Shared by every delete trigger (settings list, list
 * column header, peek section).
 *
 * Built on ModalCore (not AlertModalCore) so the content — including the
 * buttons — can be wrapped in `data-prevent-outside-click`: this modal is
 * portaled to <body>, outside the issue peek's ref, and without that opt-out
 * a click here trips use-peek-overview-outside-click and closes the
 * underlying peek (which then unmounts this modal). Mirrors the proven
 * WorkItemFieldEditorModal pattern.
 */
export const DeleteFieldModal = observer(function DeleteFieldModal(props: IDeleteFieldModal) {
  const { isOpen, handleClose, handleSubmit } = props;
  const [loader, setLoader] = useState(false);
  const { t } = useTranslation();

  const formSubmit = async () => {
    try {
      setLoader(true);
      await handleSubmit();
      handleClose();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: t("project_settings.custom_fields.toast.update_error"),
      });
    } finally {
      setLoader(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div data-prevent-outside-click className="p-5">
        <h3 className="text-16 font-medium text-primary">{t("project_settings.custom_fields.delete_confirm_title")}</h3>
        <p className="mt-2 text-13 text-secondary">{t("project_settings.custom_fields.delete_confirm_message")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={loader}>
            {t("cancel")}
          </Button>
          <Button variant="error-fill" size="sm" onClick={formSubmit} loading={loader} disabled={loader}>
            {t("project_settings.custom_fields.delete_field")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
