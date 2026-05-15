/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { WorkItemFieldCell } from "./work-item-field-cell";

interface WorkItemFieldSectionProps {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isReadOnly?: boolean;
}

/**
 * Custom-fields block for the issue detail / peek right-rail (design §8 /
 * §10 step 8). Isolated and store-backed; reuses WorkItemFieldCell. Mount
 * it in the peek sidebar — that single mount edit is the gated wiring
 * (see design §7 "gated wiring edits" rationale).
 */
export const WorkItemFieldSection = observer(function WorkItemFieldSection(props: WorkItemFieldSectionProps) {
  const { workspaceSlug, projectId, issueId, isReadOnly } = props;
  const { getProjectFields, fetchProjectFields, fetchProjectFieldValues } = useWorkItemField();
  const { t } = useTranslation();

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    fetchProjectFields(workspaceSlug, projectId).catch(() => {});
    fetchProjectFieldValues(workspaceSlug, projectId, [issueId]).catch(() => {});
  }, [workspaceSlug, projectId, issueId, fetchProjectFields, fetchProjectFieldValues]);

  const fields = (getProjectFields(projectId) ?? []).filter((f) => f.is_active);
  if (fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 py-2">
      <span className="text-13 font-medium text-secondary">{t("project_settings.custom_fields.heading")}</span>
      <div className="flex flex-col gap-2">
        {fields.map((field) => (
          <div key={field.id} className="flex items-start gap-2">
            <div className="flex w-2/5 flex-shrink-0 items-center gap-1 pt-1">
              <span className="truncate text-13 text-tertiary">{field.name}</span>
              {field.is_required && <span className="text-12 text-danger-primary">*</span>}
            </div>
            <div className="min-w-0 flex-1">
              <WorkItemFieldCell field={field} issueId={issueId} projectId={projectId} isReadOnly={isReadOnly} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
