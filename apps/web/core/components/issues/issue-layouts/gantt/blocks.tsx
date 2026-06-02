/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Popover } from "@plane/propel/popover";
import { Tooltip } from "@plane/propel/tooltip";
import { ControlLink } from "@plane/ui";
import { findTotalDaysInRange, generateWorkItemLink, renderFormattedDate } from "@plane/utils";
// components
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
// local imports
import { CompletionToggle } from "../../mark-complete";
import { WorkItemPreviewCard } from "../../preview-card";
import { getBlockViewDetails } from "../utils";
import type { GanttStoreType } from "./base-gantt-root";
import { getStatusColor } from "./section-swimlanes";

type Props = {
  issueId: string;
  isEpic?: boolean;
};

export const IssueGanttBlock = observer(function IssueGanttBlock(props: Props) {
  const { issueId, isEpic } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const { getProjectStates } = useProjectState();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  // hooks
  const { isMobile } = usePlatformOS();
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const stateDetails =
    issueDetails && getProjectStates(issueDetails?.project_id)?.find((state) => state?.id == issueDetails?.state_id);

  // Asana-style solid status colour for the shape: completed = green,
  // in-progress = amber, everything else = grey (section identity lives on the
  // swimlane header dot, not the task shape).
  const statusColor = getStatusColor(stateDetails?.group);

  const { blockStyle } = getBlockViewDetails(issueDetails, statusColor);

  const handleIssuePeekOverview = () => handleRedirection(workspaceSlug, issueDetails, isMobile);

  const duration = findTotalDaysInRange(issueDetails?.start_date, issueDetails?.target_date) || 0;

  // A task with only a due date (no start date) renders as an Asana-style
  // narrow vertical capsule marker at the due date instead of a bar.
  const isMilestone = !!issueDetails?.target_date && !issueDetails?.start_date;

  return (
    <Popover delay={100} openOnHover>
      <Popover.Button
        className="w-full"
        render={
          <div
            id={`issue-${issueId}`}
            className="relative flex h-full w-full cursor-pointer items-center"
            onClick={handleIssuePeekOverview}
          >
            {isMilestone ? (
              <>
                {/* Asana-style marker: solid narrow vertical capsule at the due date */}
                <div
                  className="h-[44px] w-[11px] flex-shrink-0 rounded-full shadow-raised-100"
                  style={{ backgroundColor: statusColor }}
                />
                <div className="pointer-events-none ml-2 flex flex-col leading-tight whitespace-nowrap">
                  <span className="text-13 font-medium text-primary">{issueDetails?.name}</span>
                  {issueDetails?.target_date && (
                    <span className="text-11 text-tertiary">Due {renderFormattedDate(issueDetails.target_date)}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Asana-style pill bar: solid colour, rounded, centred in the row */}
                <div className="h-[16px] w-full rounded-full shadow-raised-100" style={blockStyle} />
                {/* Label to the RIGHT of the bar: assignee avatar (hugging the bar end) + name + due date */}
                <div className="pointer-events-none absolute top-1/2 left-full ml-1 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap">
                  <div className="flex-shrink-0">
                    <ButtonAvatars showTooltip={false} userIds={issueDetails?.assignee_ids ?? []} size="sm" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-13 font-medium text-primary">{issueDetails?.name}</span>
                    {issueDetails?.target_date && (
                      <span className="text-11 text-tertiary">Due {renderFormattedDate(issueDetails.target_date)}</span>
                    )}
                  </div>
                </div>
              </>
            )}
            {isEpic && (
              <IssueStats
                issueId={issueId}
                className="sticky mx-2 w-auto flex-shrink-0 justify-end truncate overflow-hidden font-medium text-primary"
                showProgressText={duration >= 2}
              />
            )}
          </div>
        }
      />
      <Popover.Panel side="bottom" align="start">
        <>
          {issueDetails && issueDetails?.project_id && (
            <WorkItemPreviewCard
              projectId={issueDetails.project_id}
              stateDetails={{
                id: issueDetails.state_id ?? undefined,
              }}
              workItem={issueDetails}
            />
          )}
        </>
      </Popover.Panel>
    </Popover>
  );
});

// rendering issues on gantt sidebar
export const IssueGanttSidebarBlock = observer(function IssueGanttSidebarBlock(props: Props) {
  const { issueId, isEpic = false } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const storeType = useIssueStoreType() as GanttStoreType;
  const { issuesFilter } = useIssues(storeType);
  const { updateIssue } = useIssuesActions(storeType);
  const { getProjectIdentifierById } = useProject();
  const { allowPermissions } = useUserPermissions();

  // handlers
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);

  // derived values
  const issueDetails = getIssueById(issueId);
  const projectIdentifier = getProjectIdentifierById(issueDetails?.project_id);
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const handleIssuePeekOverview = (e: any) => {
    e.stopPropagation(true);
    e.preventDefault();
    handleRedirection(workspaceSlug, issueDetails, isMobile);
  };

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetails?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetails?.sequence_id,
    isEpic,
  });

  return (
    <ControlLink
      id={`issue-${issueId}`}
      href={workItemLink}
      onClick={handleIssuePeekOverview}
      className="line-clamp-1 w-full cursor-pointer text-13 text-primary"
      disabled={!!issueDetails?.tempId}
    >
      <div className="relative flex h-full w-full cursor-pointer items-center gap-2">
        {issueDetails?.project_id && (
          <IssueIdentifier
            issueId={issueDetails.id}
            projectId={issueDetails.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={issuesFilter?.issueFilters?.displayProperties}
          />
        )}
        {issueDetails && !isEpic && (
          <CompletionToggle issue={issueDetails} updateIssue={updateIssue} disabled={!isEditingAllowed} />
        )}
        <Tooltip tooltipContent={issueDetails?.name} isMobile={isMobile}>
          <span className="flex-grow truncate text-13 font-medium">{issueDetails?.name}</span>
        </Tooltip>
      </div>
    </ControlLink>
  );
});
