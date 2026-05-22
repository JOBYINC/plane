/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TIssuePriorities } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import type { TQuickAddIssueForm } from "../root";

export const ListQuickAddIssueForm = observer(function ListQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, register, onSubmit, isEpic, setValue, watch, prePopulatedData } = props;
  const { t } = useTranslation();

  const projectId = projectDetail?.id;
  // Inline property fields are only wired when the layout passed the
  // react-hook-form helpers (list layout). Falls back to title-only otherwise.
  const hasInlineFields = !!setValue && !!watch && !!projectId;

  const currentStateId = (watch?.("state_id") ?? prePopulatedData?.state_id) as string | undefined;
  const currentPriority = (watch?.("priority") ?? prePopulatedData?.priority) as TIssuePriorities | undefined;
  const currentTargetDate = (watch?.("target_date") ?? prePopulatedData?.target_date) as string | null | undefined;
  const currentAssignees = (watch?.("assignee_ids") ?? prePopulatedData?.assignee_ids ?? []) as string[];

  return (
    <div className="shadow-raised-200">
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="flex w-full flex-col gap-2 border-[0.5px] border-t-0 border-subtle bg-surface-1 px-3 py-2"
      >
        <div className="flex w-full items-center gap-3">
          <div className="text-11 font-medium text-placeholder">{projectDetail?.identifier ?? "..."}</div>
          <input
            type="text"
            autoComplete="off"
            placeholder={isEpic ? t("epic.title.label") : t("issue.title.label")}
            {...register("name", {
              required: isEpic ? t("epic.title.required") : t("issue.title.required"),
            })}
            className="w-full rounded-md bg-transparent px-2 py-1.5 text-13 leading-5 font-medium text-secondary outline-none"
          />
        </div>

        {hasInlineFields && (
          <div className="flex flex-wrap items-center gap-2 pl-1">
            <StateDropdown
              value={currentStateId}
              onChange={(val) => setValue?.("state_id", val, { shouldDirty: true })}
              projectId={projectId}
              buttonVariant="border-with-text"
              showTooltip
            />
            <PriorityDropdown
              value={currentPriority}
              onChange={(val) => setValue?.("priority", val, { shouldDirty: true })}
              buttonVariant="border-with-text"
              showTooltip
            />
            <DateDropdown
              value={currentTargetDate ?? null}
              onChange={(date) =>
                setValue?.("target_date", date ? (renderFormattedPayloadDate(date) ?? null) : null, {
                  shouldDirty: true,
                })
              }
              placeholder={t("common.order_by.due_date")}
              buttonVariant={currentTargetDate ? "border-with-text" : "border-without-text"}
              optionsClassName="z-10"
            />
            <MemberDropdown
              projectId={projectId}
              expandToWorkspace
              value={currentAssignees}
              onChange={(val) => setValue?.("assignee_ids", val, { shouldDirty: true })}
              multiple
              buttonVariant={currentAssignees.length > 0 ? "transparent-without-text" : "border-without-text"}
              placeholder={t("common.assignees")}
              optionsClassName="z-10"
            />
          </div>
        )}
      </form>
      <div className="px-3 py-2 text-11 text-secondary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
      </div>
    </div>
  );
});
