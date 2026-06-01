/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, GroupByColumnTypes, IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, EIssueServiceType, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProjectSection } from "@/hooks/store/use-project-section";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
// services
import { IssueService } from "@/services/issue/issue.service";
// plane web hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";

import { getGroupByColumns, isWorkspaceLevel } from "../utils";
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { IssueGanttBlock } from "./blocks";
import type { TSwimlaneSection } from "./section-swimlane-context";
import {
  DEFAULT_GANTT_SIDEBAR_WIDTH,
  SWIMLANE_SIDEBAR_WIDTH,
  SectionSwimlaneContext,
} from "./section-swimlane-context";
import {
  NO_SECTION_GROUP_ID,
  bucketIssueIdsBySection,
  buildSwimlaneBlockIds,
  getSectionColor,
} from "./section-swimlanes";

interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

export type GanttStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter, issueMap } = useIssues(storeType);
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { getSections, fetchProjectSections, fetchedMap } = useProjectSection();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  const groupBy = appliedDisplayFilters?.group_by;
  const isSectionGrouped = groupBy === "section";
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // derived values
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  useEffect(() => {
    initGantt();
  }, []);

  // Ensure sections are loaded for swimlane grouping. use-project-issue-properties
  // already fetches them on project entry; this is a defensive, idempotent fetch
  // for the case where the Timeline is the first view to need the section axis.
  useEffect(() => {
    if (!isSectionGrouped || !workspaceSlug || !projectId) return;
    if (fetchedMap[projectId.toString()]) return;
    void fetchProjectSections(workspaceSlug.toString(), projectId.toString());
  }, [isSectionGrouped, workspaceSlug, projectId, fetchedMap, fetchProjectSections]);

  const issuesIds = (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? [];
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  // Section swimlanes: when grouped by "section", interleave section-header
  // sentinel ids into the flat block list (issues bucketed client-side by
  // section_id), so the existing index→Y row math renders aligned swimlanes in
  // the sidebar, chart, and dependency overlay. Collapsed sections drop their
  // issue rows but keep the header. Any other grouping leaves the Gantt flat.
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => new Set());
  const toggleSectionCollapse = useCallback((groupId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // Reactive read so the observer + memo recompute once sections finish loading
  // (getGroupByColumns reads the same store but isn't itself a memo signal).
  const loadedSections = isSectionGrouped ? getSections(projectId?.toString()) : [];
  const loadedSectionsKey = loadedSections.map((section) => section.id).join(",");

  const sectionGroups = useMemo(
    () =>
      isSectionGrouped
        ? (getGroupByColumns({
            groupBy: "section" as GroupByColumnTypes,
            includeNone: true,
            isWorkspaceLevel: isWorkspaceLevel(storeType),
            isEpic,
            projectId: projectId?.toString(),
          }) ?? [])
        : [],
    [isSectionGrouped, storeType, isEpic, projectId, loadedSectionsKey]
  );

  const { swimlaneBlockIds, sectionsById, sectionColorByGroupId } = useMemo(() => {
    if (!isSectionGrouped || sectionGroups.length === 0) {
      return { swimlaneBlockIds: issuesIds, sectionsById: {}, sectionColorByGroupId: {} as Record<string, string> };
    }
    const issueIdsBySection = bucketIssueIdsBySection(issuesIds, issueMap, sectionGroups);
    const sectionsMeta: Record<string, TSwimlaneSection> = {};
    const colorByGroupId: Record<string, string> = {};
    sectionGroups.forEach((group, index) => {
      const color = getSectionColor(group.id, index);
      colorByGroupId[group.id] = color;
      sectionsMeta[group.id] = {
        id: group.id,
        name: group.name,
        count: issueIdsBySection[group.id]?.length ?? 0,
        color,
      };
    });
    return {
      swimlaneBlockIds: buildSwimlaneBlockIds(sectionGroups, issueIdsBySection, collapsedSectionIds),
      sectionsById: sectionsMeta,
      sectionColorByGroupId: colorByGroupId,
    };
  }, [isSectionGrouped, sectionGroups, issuesIds, issueMap, collapsedSectionIds]);

  const getColorForSection = useCallback(
    (sectionId: string | null | undefined) => sectionColorByGroupId[sectionId ?? NO_SECTION_GROUP_ID],
    [sectionColorByGroupId]
  );

  // Seed collapsed state from each section's is_collapsed_default exactly once
  // per project, so a user's manual toggles afterwards are never overwritten.
  const seededCollapseProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isSectionGrouped || !projectId) return;
    const key = projectId.toString();
    if (seededCollapseProjectRef.current === key) return;
    const sections = getSections(key);
    if (sections.length === 0) return; // not loaded yet
    seededCollapseProjectRef.current = key;
    const defaults = sections.filter((section) => section.is_collapsed_default).map((section) => section.id);
    if (defaults.length > 0) setCollapsedSectionIds(new Set(defaults));
  }, [isSectionGrouped, projectId, getSections]);

  const swimlaneContextValue = useMemo(
    () => ({
      enabled: isSectionGrouped,
      sidebarWidth: isSectionGrouped ? SWIMLANE_SIDEBAR_WIDTH : DEFAULT_GANTT_SIDEBAR_WIDTH,
      sectionsById,
      collapsedIds: collapsedSectionIds,
      toggleCollapse: toggleSectionCollapse,
      getColorForSection,
    }),
    [isSectionGrouped, sectionsById, collapsedSectionIds, toggleSectionCollapse, getColorForSection]
  );

  // Hydrate issue relations for the timeline's blocks so the Asana-style
  // dependency connectors (ce TimelineDependencyPaths) can render. Isolated and
  // best-effort: it hits the `issues/list/` endpoint (flat array) with
  // expand=issue_relation,issue_related and feeds the relation store — it never
  // touches the Gantt's paginated list fetch, so a failure just means no arrows.
  const serviceType = isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES;
  const issueService = useMemo(() => new IssueService(serviceType), [serviceType]);
  const {
    relation: { extractRelationsFromIssues },
  } = useIssueDetail(serviceType);
  const hydratedRelationIdsRef = useRef<Set<string>>(new Set());
  const issuesIdsKey = issuesIds.join(",");

  useEffect(() => {
    const ids = issuesIdsKey ? issuesIdsKey.split(",") : [];
    if (!workspaceSlug || !projectId || ids.length === 0) return;
    const pendingIds = ids.filter((id) => !hydratedRelationIdsRef.current.has(id));
    if (pendingIds.length === 0) return;

    let cancelled = false;
    const CHUNK_SIZE = 50; // keep the `issues=<csv>` query string bounded
    void (async () => {
      for (let i = 0; i < pendingIds.length; i += CHUNK_SIZE) {
        const chunk = pendingIds.slice(i, i + CHUNK_SIZE);
        try {
          const issuesWithRelations = await issueService.retrieveIssues(
            workspaceSlug.toString(),
            projectId.toString(),
            chunk,
            "issue_relation,issue_related"
          );
          if (cancelled) return;
          if (Array.isArray(issuesWithRelations) && issuesWithRelations.length > 0) {
            extractRelationsFromIssues(issuesWithRelations);
            chunk.forEach((id) => hydratedRelationIdsRef.current.add(id));
          }
        } catch {
          // best-effort: the timeline renders normally, just without dependency arrows
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, issuesIdsKey, issueService, extractRelationsFromIssues]);

  const { enableIssueCreation } = issues?.viewFlags || {};

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    updateIssue && (await updateIssue(issue.project_id, issue.id, payload));
  };

  const isAllowed = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const updateBlockDates = useCallback(
    (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) =>
      issues.updateIssueDates(workspaceSlug.toString(), updates, projectId.toString()).catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      }),
    [issues, projectId, workspaceSlug]
  );

  const quickAdd =
    enableIssueCreation && isAllowed && !isCompletedCycle ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={{
          start_date: renderFormattedPayloadDate(new Date()),
          target_date: renderFormattedPayloadDate(targetDate),
        }}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        <SectionSwimlaneContext.Provider value={swimlaneContextValue}>
          <div className="h-full w-full">
            <GanttChartRoot
              border={false}
              title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
              loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
              blockIds={swimlaneBlockIds}
              blockUpdateHandler={updateIssueBlockStructure}
              blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
              sidebarToRender={(props) => <IssueGanttSidebar {...props} showAllBlocks isEpic={isEpic} />}
              enableBlockLeftResize={isAllowed}
              enableBlockRightResize={isAllowed}
              enableBlockMove={isAllowed}
              enableReorder={appliedDisplayFilters?.order_by === "sort_order" && isAllowed}
              enableAddBlock={isAllowed}
              enableSelection={isBulkOperationsEnabled && isAllowed}
              quickAdd={quickAdd}
              loadMoreBlocks={loadMoreIssues}
              canLoadMoreBlocks={nextPageResults}
              updateBlockDates={updateBlockDates}
              showAllBlocks
              enableDependency
              isEpic={isEpic}
            />
          </div>
        </SectionSwimlaneContext.Provider>
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
