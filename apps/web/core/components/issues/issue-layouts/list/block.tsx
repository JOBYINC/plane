/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronRightIcon } from "@plane/propel/icons";
// types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, IIssueDisplayProperties, TIssueMap } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { Spinner, ControlLink, Row } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import { MultipleSelectEntityAction } from "@/components/core/multiple-select";
import { IssueProperties } from "@/components/issues/issue-layouts/properties";
import { WorkItemFieldCell } from "@/components/work-item-fields";
// helpers
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
// types
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";
import { calculateIdentifierWidth } from "../utils";
import { CELL_BY_COLUMN } from "./columns/issue-cells";
import { customColumnKeyToFieldId, getOrderedListColumns } from "./columns/list-columns";
import type { TRenderQuickActions } from "./list-view-types";

interface IssueBlockProps {
  issueId: string;
  issuesMap: TIssueMap;
  groupId: string;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  columnOrder?: string[];
  canEditProperties: (projectId: string | undefined) => boolean;
  nestingLevel: number;
  spacingLeft?: number;
  isExpanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  selectionHelpers: TSelectionHelper;
  isCurrentBlockDragging: boolean;
  setIsCurrentBlockDragging: React.Dispatch<React.SetStateAction<boolean>>;
  canDrag: boolean;
  isEpic?: boolean;
}

export const IssueBlock = observer(function IssueBlock(props: IssueBlockProps) {
  const {
    issuesMap,
    issueId,
    groupId,
    updateIssue,
    quickActions,
    displayProperties,
    columnOrder,
    canEditProperties,
    nestingLevel,
    spacingLeft = 14,
    isExpanded,
    setExpanded,
    selectionHelpers,
    isCurrentBlockDragging,
    setIsCurrentBlockDragging,
    canDrag,
    isEpic = false,
  } = props;
  // ref
  const issueRef = useRef<HTMLDivElement | null>(null);
  // router
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  const projectId = routerProjectId?.toString();
  // hooks
  const { sidebarCollapsed: isSidebarCollapsed } = useAppTheme();
  const { getProjectIdentifierById, currentProjectNextSequenceId } = useProject();
  const {
    getIsIssuePeeked,
    peekIssue,
    setPeekIssue,
    subIssues: subIssuesStore,
  } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);

  const handleIssuePeekOverview = (issue: TIssue) =>
    workspaceSlug &&
    issue &&
    issue.project_id &&
    issue.id &&
    !getIsIssuePeeked(issue.id) &&
    setPeekIssue({
      workspaceSlug,
      projectId: issue.project_id,
      issueId: issue.id,
      nestingLevel: nestingLevel,
      isArchived: !!issue.archived_at,
    });

  // derived values
  const issue = issuesMap[issueId];
  const subIssuesCount = issue?.sub_issues_count ?? 0;
  const canEditIssueProperties = canEditProperties(issue?.project_id ?? undefined);
  const isDraggingAllowed = canDrag && canEditIssueProperties;
  // ONE unified ordered column sequence (Inc A) — MUST match the sticky
  // header + --list-cols grid template so every cell lines up with its track.
  const orderedColumns = getOrderedListColumns(displayProperties, { isEpic }, columnOrder);
  const { getFieldById } = useWorkItemField();

  const { isMobile } = usePlatformOS();

  useEffect(() => {
    const element = issueRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        canDrag: () => isDraggingAllowed,
        getInitialData: () => ({ id: issueId, type: "ISSUE", groupId }),
        onDragStart: () => {
          setIsCurrentBlockDragging(true);
        },
        onDrop: () => {
          setIsCurrentBlockDragging(false);
        },
      })
    );
  }, [isDraggingAllowed, issueId, groupId, setIsCurrentBlockDragging]);

  if (!issue) return null;

  const projectIdentifier = getProjectIdentifierById(issue.project_id);
  const isIssueSelected = selectionHelpers.getIsEntitySelected(issue.id);
  const isIssueActive = selectionHelpers.getIsEntityActive(issue.id);
  const isSubIssue = nestingLevel !== 0;
  const canSelectIssues = canEditIssueProperties && !selectionHelpers.isSelectionDisabled;

  const marginLeft = `${spacingLeft}px`;

  const handleToggleExpand = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (nestingLevel >= 3) {
      handleIssuePeekOverview(issue);
    } else {
      setExpanded((prevState) => {
        if (!prevState && workspaceSlug && issue && issue.project_id)
          subIssuesStore.fetchSubIssues(workspaceSlug.toString(), issue.project_id, issue.id);
        return !prevState;
      });
    }
  };

  // Calculate width for: projectIdentifier + "-" + dynamic sequence number digits
  // Use next_work_item_sequence from backend (static value from project endpoint)
  const maxSequenceId = currentProjectNextSequenceId ?? 1;
  const keyMinWidth = displayProperties?.key
    ? calculateIdentifierWidth(projectIdentifier?.length ?? 0, maxSequenceId)
    : 0;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issue?.sequence_id,
    isEpic,
    isArchived: !!issue?.archived_at,
  });
  return (
    <ControlLink
      id={`issue-${issue.id}`}
      href={workItemLink}
      onClick={() => handleIssuePeekOverview(issue)}
      className="w-full cursor-pointer"
      disabled={!!issue?.tempId || issue?.is_draft}
    >
      <Row
        ref={issueRef}
        className={cn(
          "group/list-block relative min-h-11 bg-layer-transparent py-3 text-13 transition-colors hover:bg-layer-transparent-hover",
          // Mobile: stacked flex column (title row + properties pill row).
          // Desktop: CSS Grid aligned with the sticky column header above.
          "flex flex-col gap-3",
          isSidebarCollapsed
            ? "md:grid md:grid-cols-[var(--list-cols)] md:items-center md:gap-2"
            : "lg:grid lg:grid-cols-[var(--list-cols)] lg:items-center lg:gap-2",
          {
            "border-accent-strong": getIsIssuePeeked(issue.id) && peekIssue?.nestingLevel === nestingLevel,
            "border-strong-1": isIssueActive,
            "last:border-b-transparent": !getIsIssuePeeked(issue.id) && !isIssueActive,
            "bg-accent-primary/5 hover:bg-accent-primary/10": isIssueSelected,
            "bg-layer-1": isCurrentBlockDragging,
          }
        )}
        onDragStart={() => {
          if (!isDraggingAllowed) {
            setToast({
              type: TOAST_TYPE.WARNING,
              title: "Cannot move work item",
              message: !canEditIssueProperties
                ? "You are not allowed to move this work item"
                : "Drag and drop is disabled for the current grouping",
            });
          }
        }}
      >
        <div
          className={cn(
            "flex w-full gap-2 truncate",
            isSidebarCollapsed ? "md:border-r md:border-subtle" : "lg:border-r lg:border-subtle"
          )}
        >
          <div className="flex flex-grow items-center gap-0.5 truncate">
            <div className="flex items-center gap-1" style={isSubIssue ? { marginLeft } : {}}>
              {/* select checkbox */}
              {projectId && canSelectIssues && !isEpic && (
                <Tooltip
                  tooltipContent={
                    <>
                      Only work items within the current
                      <br />
                      project can be selected.
                    </>
                  }
                  disabled={issue.project_id === projectId}
                >
                  <div className="absolute left-1 grid w-3.5 flex-shrink-0 place-items-center">
                    <MultipleSelectEntityAction
                      className={cn(
                        "pointer-events-none opacity-0 transition-opacity group-hover/list-block:pointer-events-auto group-hover/list-block:opacity-100",
                        {
                          "pointer-events-auto opacity-100": isIssueSelected,
                        }
                      )}
                      groupId={groupId}
                      id={issue.id}
                      selectionHelpers={selectionHelpers}
                      disabled={issue.project_id !== projectId}
                    />
                  </div>
                </Tooltip>
              )}
              {displayProperties && (displayProperties.key || displayProperties.issue_type) && (
                <div className="flex-shrink-0" style={{ minWidth: `${keyMinWidth}px` }}>
                  {issue.project_id && (
                    <IssueIdentifier
                      issueId={issueId}
                      projectId={issue.project_id}
                      size="xs"
                      variant="tertiary"
                      displayProperties={displayProperties}
                    />
                  )}
                </div>
              )}

              {/* sub-issues chevron */}
              <div className="grid size-4 flex-shrink-0 place-items-center">
                {subIssuesCount > 0 && !isEpic && (
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded-xs text-placeholder hover:text-tertiary"
                    onClick={handleToggleExpand}
                  >
                    <ChevronRightIcon
                      className={cn("size-4", {
                        "rotate-90": isExpanded,
                      })}
                      strokeWidth={2.5}
                    />
                  </button>
                )}
              </div>

              {issue?.tempId !== undefined && (
                <div className="absolute top-0 left-0 z-[99999] h-full w-full animate-pulse bg-surface-1/20" />
              )}
            </div>

            <Tooltip
              tooltipContent={issue.name}
              isMobile={isMobile}
              position="top-start"
              disabled={isCurrentBlockDragging}
              renderByDefault={false}
            >
              <p className="cursor-pointer truncate text-body-xs-medium text-primary">{issue.name}</p>
            </Tooltip>
            {isEpic && displayProperties && (
              <WithDisplayPropertiesHOC
                displayProperties={displayProperties}
                displayPropertyKey="sub_issue_count"
                shouldRenderProperty={(properties) => !!properties.sub_issue_count}
              >
                <IssueStats issueId={issue.id} className="ml-2 text-body-xs-medium text-tertiary" />
              </WithDisplayPropertiesHOC>
            )}
          </div>
          {!issue?.tempId && (
            <div
              className={cn("block rounded-sm border border-strong", {
                "md:hidden": isSidebarCollapsed,
                "lg:hidden": !isSidebarCollapsed,
              })}
            >
              {quickActions({
                issue,
                parentRef: issueRef,
              })}
            </div>
          )}
        </div>
        {/* Mobile/pill mode: existing flex-wrap pill row */}
        <div className={cn("flex flex-shrink-0 items-center gap-2", isSidebarCollapsed ? "md:hidden" : "lg:hidden")}>
          {!issue?.tempId ? (
            <IssueProperties
              className="relative flex flex-wrap items-center gap-2 whitespace-nowrap"
              issue={issue}
              isReadOnly={!canEditIssueProperties}
              updateIssue={updateIssue}
              displayProperties={displayProperties}
              activeLayout="List"
              isEpic={isEpic}
            />
          ) : (
            <div className="h-4 w-4">
              <Spinner className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* Desktop/grid mode: per-column cells aligned with sticky header.
            display:contents flattens this wrapper so its children become grid items
            of the outer Row, sharing the same --list-cols template. */}
        <div
          className={cn(
            "hidden [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-subtle",
            isSidebarCollapsed ? "md:contents" : "lg:contents"
          )}
        >
          {orderedColumns.map((d) => {
            if (d.kind === "builtin") {
              const Cell = CELL_BY_COLUMN[d.key];
              return (
                <div key={d.key} className="flex min-w-0 items-center">
                  {!issue?.tempId ? (
                    <Cell
                      issue={issue}
                      updateIssue={updateIssue}
                      isReadOnly={!canEditIssueProperties}
                      isEpic={isEpic}
                    />
                  ) : null}
                </div>
              );
            }
            // Custom field. Always render the slot div so the grid stays
            // aligned even before the field schema resolves (may be null
            // briefly).
            const field = getFieldById(customColumnKeyToFieldId(d.key));
            return (
              <div key={d.key} className="flex min-w-0 items-center">
                {!issue?.tempId && field && issue?.project_id ? (
                  <WorkItemFieldCell
                    field={field}
                    issueId={issue.id}
                    projectId={issue.project_id}
                    isReadOnly={!canEditIssueProperties}
                  />
                ) : null}
              </div>
            );
          })}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="flex items-center justify-end"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {!issue?.tempId ? quickActions({ issue, parentRef: issueRef }) : <Spinner className="h-4 w-4" />}
          </div>
        </div>
      </Row>
    </ControlLink>
  );
});
