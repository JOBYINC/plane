/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Check } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { getMarkCompleteTarget } from "../mark-complete";

type TMarkCompleteButtonProps = {
  projectId: string;
  stateId: string | null | undefined;
  disabled: boolean;
  updateIssue: (data: Partial<TIssue>) => Promise<void>;
};

export const MarkCompleteButton = observer(function MarkCompleteButton(props: TMarkCompleteButtonProps) {
  const { projectId, stateId, disabled, updateIssue } = props;
  // states
  const [isUpdating, setIsUpdating] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { getProjectStates, getProjectDefaultStateId } = useProjectState();
  // derived values
  const projectStates = getProjectStates(projectId);
  const { isCompleted, targetStateId } = getMarkCompleteTarget(
    projectStates,
    stateId,
    getProjectDefaultStateId(projectId)
  );

  // hide the button entirely when the project has no completed/reopen state to move into
  if (!targetStateId) return null;

  const handleClick = async () => {
    if (disabled || isUpdating || stateId === targetStateId) return;
    setIsUpdating(true);
    try {
      await updateIssue({ state_id: targetStateId });
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Tooltip
      tooltipContent={isCompleted ? t("issue.mark_complete.reopen_tooltip") : ""}
      disabled={!isCompleted || disabled}
      isMobile={isMobile}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isUpdating}
        className={cn(
          "flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-body-xs-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          isCompleted
            ? "border-success-strong bg-success-subtle text-success-secondary hover:bg-success-subtle-1"
            : "border-strong bg-layer-2 text-secondary hover:border-success-strong hover:text-success-secondary"
        )}
      >
        <Check className={cn("h-3.5 w-3.5", isCompleted ? "text-success-primary" : "text-tertiary")} />
        {isCompleted ? t("issue.mark_complete.completed") : t("issue.mark_complete.action")}
      </button>
    </Tooltip>
  );
});
