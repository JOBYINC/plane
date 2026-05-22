/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams, useRouter } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";

interface Props {
  isOpen: boolean;
  sourceProjectId: string | null;
  onClose: () => void;
}

// A launch project created from a template shouldn't inherit the
// template's "(Template)" suffix — e.g. "Q3 Launch (Template)" seeds the
// new project's name as "Q3 Launch", not "Q3 Launch (Template) (Copy)".
const stripTemplateSuffix = (name: string): string => name.replace(/\s*\(Template\)\s*$/i, "").trim();

/**
 * Minimal modal that drives the server-side project duplicate. Captures
 * just the things you'd change per-launch:
 *  - name (defaults to the template name minus its "(Template)" suffix)
 *  - start date — re-anchors the cloned timeline so the template's
 *    earliest date lands on this date and every other date shifts with
 *    it, preserving the project's overall span. Defaults to today.
 *
 * On success, navigates to the new project. Custom field overrides
 * (e.g. Tier) aren't surfaced here yet — the API supports it but a UI
 * for arbitrary {field: value} needs the clone's field schema first.
 */
export const UseTemplateModal = observer(function UseTemplateModal(props: Props) {
  const { isOpen, sourceProjectId, onClose } = props;
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const router = useRouter();
  const { getPartialProjectById, duplicateProject } = useProject();

  const source = sourceProjectId ? getPartialProjectById(sourceProjectId) : undefined;

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the form whenever a new template is opened: name from the
  // template, start date back to today.
  useEffect(() => {
    if (!isOpen || !source) return;
    setName(stripTemplateSuffix(source.name));
    setStartDate(new Date().toISOString().slice(0, 10));
  }, [isOpen, source]);

  const handleSubmit = async () => {
    if (!workspaceSlug || !sourceProjectId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const clone = await duplicateProject(workspaceSlug.toString(), sourceProjectId, {
        name: name.trim() || undefined,
        anchor_start_date: startDate || undefined,
      });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success", { defaultValue: "Success" }),
        message: `Project "${clone.name}" created from template`,
      });
      onClose();
      router.push(`/${workspaceSlug}/projects/${clone.id}/issues`);
    } catch (error) {
      const message =
        typeof error === "object" && error && "error" in error && typeof error.error === "string"
          ? error.error
          : "Failed to duplicate project. See server logs.";
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} position={EModalPosition.TOP} width={EModalWidth.XL} handleClose={onClose}>
      <div className="space-y-4 p-5">
        <div>
          <h3 className="text-lg font-semibold text-primary">{t("use_template", { defaultValue: "Use template" })}</h3>
          {source && (
            <p className="mt-1 text-13 text-tertiary">
              {t("use_template_subtitle", {
                defaultValue:
                  "Create a new project from this template. Every issue, cycle, module, custom field, and blocked_by relation is cloned server-side.",
              })}
            </p>
          )}
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-13 font-medium text-secondary">{t("name", { defaultValue: "Project name" })}</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={source ? stripTemplateSuffix(source.name) : "New project name"}
            />
          </div>
          <div className="space-y-1">
            <label className="text-13 font-medium text-secondary">{t("template_start_date")}</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <p className="text-11 text-tertiary">{t("template_start_date_hint")}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t("cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={isSubmitting}>
            {isSubmitting
              ? t("creating", { defaultValue: "Creating…" })
              : t("create_from_template", { defaultValue: "Create project" })}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
