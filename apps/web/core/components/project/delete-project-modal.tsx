/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle } from "lucide-react";
// Plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IProject } from "@plane/types";
import { Input, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type DeleteProjectModal = {
  isOpen: boolean;
  project: IProject;
  onClose: () => void;
};

const defaultValues = {
  projectName: "",
  confirmDelete: "",
};

export function DeleteProjectModal(props: DeleteProjectModal) {
  const { isOpen, project, onClose } = props;
  // store hooks
  const { deleteProject } = useProject();
  // router
  const router = useAppRouter();
  const { workspaceSlug, projectId } = useParams();
  // translation
  const { t } = useTranslation();
  // form info
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    reset,
    watch,
  } = useForm({ defaultValues });

  const canDelete = watch("projectName") === project?.name && watch("confirmDelete") === "delete my project";

  const handleClose = () => {
    const timer = setTimeout(() => {
      reset(defaultValues);
      clearTimeout(timer);
    }, 350);

    onClose();
  };

  const onSubmit = async () => {
    if (!workspaceSlug || !canDelete) return;

    try {
      await deleteProject(workspaceSlug.toString(), project.id);
      if (projectId && projectId.toString() === project.id) router.push(`/${workspaceSlug}/projects`);
      handleClose();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: t("delete_project_modal.success_message"),
      });
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("common.something_went_wrong"),
      });
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6 p-6">
        <div className="flex w-full items-center justify-start gap-6">
          <span className="place-items-center rounded-full bg-danger-subtle p-4">
            <AlertTriangle className="h-6 w-6 text-danger-primary" aria-hidden="true" />
          </span>
          <span className="flex items-center justify-start">
            <h3 className="text-18 font-medium 2xl:text-20">{t("delete_project_modal.title")}</h3>
          </span>
        </div>
        <span>
          <p className="text-13 leading-7 text-secondary">
            {t("delete_project_modal.warning_prefix")}{" "}
            <span className="font-semibold break-words">{project?.name}</span>
            {t("delete_project_modal.warning_suffix")}
          </p>
        </span>
        <div className="text-secondary">
          <p className="text-13 break-words">
            {t("delete_project_modal.name_prompt_prefix")}{" "}
            <span className="font-medium text-primary">{project?.name}</span>
            {t("delete_project_modal.name_prompt_suffix")}
          </p>
          <Controller
            control={control}
            name="projectName"
            render={({ field: { value, onChange, ref } }) => (
              <Input
                id="projectName"
                name="projectName"
                type="text"
                value={value}
                onChange={onChange}
                ref={ref}
                hasError={Boolean(errors.projectName)}
                placeholder={t("common.project_name")}
                className="mt-2 w-full"
                autoComplete="off"
              />
            )}
          />
        </div>
        <div className="text-secondary">
          <p className="text-13">
            {t("delete_project_modal.confirm_prompt_prefix")}{" "}
            <span className="font-medium text-primary">delete my project</span>
            {t("delete_project_modal.confirm_prompt_suffix")}
          </p>
          <Controller
            control={control}
            name="confirmDelete"
            render={({ field: { value, onChange, ref } }) => (
              <Input
                id="confirmDelete"
                name="confirmDelete"
                type="text"
                value={value}
                onChange={onChange}
                ref={ref}
                hasError={Boolean(errors.confirmDelete)}
                placeholder={t("delete_project_modal.confirm_placeholder")}
                className="mt-2 w-full"
                autoComplete="off"
              />
            )}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="error-fill" size="lg" type="submit" disabled={!canDelete} loading={isSubmitting}>
            {isSubmitting ? t("delete_project_modal.deleting") : t("delete_project_modal.title")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
