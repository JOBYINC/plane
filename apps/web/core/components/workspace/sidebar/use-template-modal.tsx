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

/**
 * Minimal modal that drives the server-side project duplicate. Captures
 * just the things you'd change per-launch:
 *  - name (defaults to "<source> (Copy)")
 *  - rebump_target_dates_by_days (shifts every issue's target_date)
 *  - rebump_cycle_windows_by_days (shifts every cycle's start/end)
 *
 * On success, navigates to the new project. Custom field overrides
 * (e.g. Tier) aren't surfaced here yet — that's a v1.5 nice-to-have
 * since the API supports it but a UI for arbitrary {field: value}
 * needs the clone's field schema fetched first. Workaround for now:
 * after the clone lands, bulk-PATCH the field via the existing
 * work-item-fields token API.
 */
export const UseTemplateModal = observer(function UseTemplateModal(props: Props) {
  const { isOpen, sourceProjectId, onClose } = props;
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const router = useRouter();
  const { getPartialProjectById, duplicateProject } = useProject();

  const source = sourceProjectId ? getPartialProjectById(sourceProjectId) : undefined;

  const [name, setName] = useState("");
  const [rebumpIssueDays, setRebumpIssueDays] = useState("0");
  const [rebumpCycleDays, setRebumpCycleDays] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form whenever a new template is opened so the previous launch's
  // rebump values don't bleed into the next one.
  useEffect(() => {
    if (!isOpen || !source) return;
    setName(`${source.name} (Copy)`);
    setRebumpIssueDays("0");
    setRebumpCycleDays("0");
  }, [isOpen, source]);

  const handleSubmit = async () => {
    if (!workspaceSlug || !sourceProjectId || isSubmitting) return;
    const parsedIssueDays = Number.parseInt(rebumpIssueDays, 10);
    const parsedCycleDays = Number.parseInt(rebumpCycleDays, 10);
    if (Number.isNaN(parsedIssueDays) || Number.isNaN(parsedCycleDays)) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: "Rebump days must be integers",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const clone = await duplicateProject(workspaceSlug.toString(), sourceProjectId, {
        name: name.trim() || undefined,
        rebump_target_dates_by_days: parsedIssueDays,
        rebump_cycle_windows_by_days: parsedCycleDays,
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
              placeholder={source ? `${source.name} (Copy)` : "New project name"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-13 font-medium text-secondary">
                {t("rebump_issue_days", { defaultValue: "Shift issue dates (days)" })}
              </label>
              <Input
                type="number"
                value={rebumpIssueDays}
                onChange={(e) => setRebumpIssueDays(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-13 font-medium text-secondary">
                {t("rebump_cycle_days", { defaultValue: "Shift cycle windows (days)" })}
              </label>
              <Input
                type="number"
                value={rebumpCycleDays}
                onChange={(e) => setRebumpCycleDays(e.target.value)}
                placeholder="0"
              />
            </div>
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
