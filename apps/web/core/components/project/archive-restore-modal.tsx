/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// ui
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type Props = {
  workspaceSlug: string;

  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  archive: boolean;
};

export function ArchiveRestoreProjectModal(props: Props) {
  const { workspaceSlug, projectId, isOpen, onClose, archive } = props;
  // router
  const router = useAppRouter();
  // states
  const [isLoading, setIsLoading] = useState(false);
  // store hooks
  const { getProjectById, archiveProject, restoreProject } = useProject();
  // translation
  const { t } = useTranslation();

  const projectDetails = getProjectById(projectId);
  if (!projectDetails) return null;

  const handleClose = () => {
    setIsLoading(false);
    onClose();
  };

  const handleArchiveProject = async () => {
    setIsLoading(true);
    await archiveProject(workspaceSlug, projectId)
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("archive_restore_modal.archive_success_title"),
          message: t("archive_restore_modal.archive_success_message", { name: projectDetails.name }),
        });
        onClose();
        router.push(`/${workspaceSlug}/projects/`);
        return;
      })
      .catch(() =>
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: t("archive_restore_modal.archive_error_message"),
        })
      )
      .finally(() => setIsLoading(false));
  };

  const handleRestoreProject = async () => {
    setIsLoading(true);
    await restoreProject(workspaceSlug, projectId)
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("archive_restore_modal.restore_success_title"),
          message: t("archive_restore_modal.restore_success_message", { name: projectDetails.name }),
        });
        onClose();
        router.push(`/${workspaceSlug}/projects/`);
        return;
      })
      .catch(() =>
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: t("archive_restore_modal.restore_error_message"),
        })
      )
      .finally(() => setIsLoading(false));
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="px-5 py-4">
        <h3 className="text-18 font-medium 2xl:text-20">
          {archive
            ? t("archive_restore_modal.archive_title", { name: projectDetails.name })
            : t("archive_restore_modal.restore_title", { name: projectDetails.name })}
        </h3>
        <p className="mt-3 text-13 text-secondary">
          {archive ? t("archive_restore_modal.archive_description") : t("archive_restore_modal.restore_description")}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="lg"
            tabIndex={1}
            onClick={archive ? handleArchiveProject : handleRestoreProject}
            loading={isLoading}
          >
            {archive
              ? isLoading
                ? t("archive_restore_modal.archiving")
                : t("common.actions.archive")
              : isLoading
                ? t("archive_restore_modal.restoring")
                : t("common.actions.restore")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
