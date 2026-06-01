/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Circle, CircleCheck } from "lucide-react";
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
import { getMarkCompleteTarget } from "./helper";

type TCompletionToggleProps = {
  issue: TIssue;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  disabled?: boolean;
  className?: string;
};

/**
 * Asana-style completion circle for issue rows/cards. Click toggles the issue
 * between its first completed state and the project's default state.
 */
export const CompletionToggle = observer(function CompletionToggle(props: TCompletionToggleProps) {
  const { issue, updateIssue, disabled = false, className } = props;
  // states
  const [isUpdating, setIsUpdating] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { getProjectStates, getProjectDefaultStateId } = useProjectState();
  // derived values
  const projectStates = getProjectStates(issue.project_id);
  const { isCompleted, targetStateId } = getMarkCompleteTarget(
    projectStates,
    issue.state_id,
    getProjectDefaultStateId(issue.project_id)
  );

  // nothing to indicate or act on (e.g. project has no completed state)
  if (!isCompleted && !targetStateId) return null;

  const isInteractive = !disabled && !!updateIssue && !!targetStateId && !issue.tempId;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isInteractive || isUpdating || !targetStateId) return;
    setIsUpdating(true);
    try {
      await updateIssue?.(issue.project_id, issue.id, { state_id: targetStateId });
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
      tooltipContent={isCompleted ? t("issue.mark_complete.completed") : t("issue.mark_complete.action")}
      disabled={!isInteractive}
      isMobile={isMobile}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={!isInteractive || isUpdating}
        aria-label={isCompleted ? t("issue.mark_complete.completed") : t("issue.mark_complete.action")}
        className={cn(
          "group/ct grid size-4 flex-shrink-0 place-items-center",
          isInteractive ? "cursor-pointer" : "cursor-default",
          className
        )}
      >
        {isCompleted ? (
          <CircleCheck className="size-4 text-success-primary" />
        ) : isInteractive ? (
          <>
            <Circle className="size-4 text-placeholder transition-colors group-hover/ct:hidden" />
            <CircleCheck className="hidden size-4 text-success-primary group-hover/ct:block" />
          </>
        ) : (
          <Circle className="size-4 text-placeholder" />
        )}
      </button>
    </Tooltip>
  );
});
