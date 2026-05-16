/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore } from "@plane/ui";

interface IDeleteFieldModal {
  isOpen: boolean;
  handleClose: () => void;
  handleSubmit: () => Promise<void>;
}

/**
 * Confirmation dialog for deleting a custom field. The backend soft-archives
 * (is_active=false) but the field + all its values become permanently
 * inaccessible from the UI (no restore entry), so this is treated as a
 * destructive, irreversible action. Shared by every delete trigger
 * (settings list, list column header, peek section).
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
    <AlertModalCore
      handleClose={handleClose}
      handleSubmit={formSubmit}
      isSubmitting={loader}
      isOpen={isOpen}
      title={t("project_settings.custom_fields.delete_confirm_title")}
      content={t("project_settings.custom_fields.delete_confirm_message")}
    />
  );
});
