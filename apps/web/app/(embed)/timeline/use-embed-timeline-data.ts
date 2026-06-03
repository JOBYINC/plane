/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { set } from "lodash-es";
import { runInAction } from "mobx";
// plane imports
import { EIssuesStoreType } from "@plane/types";
import type { IssuePaginationOptions, IUserLite, TIssue, TIssuesResponse } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useMember } from "@/hooks/store/use-member";
import { useProjectSection } from "@/hooks/store/use-project-section";
import { useProjectState } from "@/hooks/store/use-project-state";
// services
import { AnchorService } from "@/services/anchor.service";

/**
 * The issue store's fetch seam. `onfetchIssues` is a public method on the base
 * issues store but isn't surfaced on the narrow `IProjectIssues` hook type, so we
 * reach it through this minimal structural type.
 */
type TIssueStoreFetchSeam = {
  onfetchIssues: (
    issuesResponse: TIssuesResponse,
    options: IssuePaginationOptions,
    workspaceSlug: string,
    projectId?: string,
    id?: string,
    shouldClearPaginationOptions?: boolean
  ) => void;
};

export type TEmbedTimelineData = {
  isLoading: boolean;
  error: string | undefined;
  projectId: string | undefined;
  workspaceSlug: string | undefined;
  projectName: string | undefined;
};

/**
 * Loads a published project's Timeline data from the public (anchor) API and
 * populates the existing mobx stores, so the reused `BaseGanttRoot` renders
 * identically to the authed view — but read-only and without a session.
 *
 * Population seams (mirrors how the authed fetches store their data):
 * - issues   → `issueStore.onfetchIssues` (same response shape as the authed
 *              project issues endpoint, since both use the `issue_on_results` grouper)
 * - states   → `stateMap` (bar status colour)
 * - sections → `sectionMap` (swimlane headers/order; project_id is added back
 *              client-side because the public payload omits it)
 * - members  → `memberMap` (assignee avatars)
 * - relations→ `relation.extractRelationsFromIssues` (dependency arrows), injected
 *              AFTER `onfetchIssues` so it overrides the empty entries that call seeds
 */
export function useEmbedTimelineData(anchor: string): TEmbedTimelineData {
  const anchorService = useMemo(() => new AnchorService(), []);
  // stores
  const { issues } = useIssues(EIssuesStoreType.PROJECT);
  const stateStore = useProjectState();
  const sectionStore = useProjectSection();
  const memberStore = useMember();
  const {
    relation: { extractRelationsFromIssues },
  } = useIssueDetail();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [workspaceSlug, setWorkspaceSlug] = useState<string | undefined>(undefined);
  const [projectName, setProjectName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!anchor) return;

    // `cancelled` guards setState after unmount. Population into the shared mobx
    // stores is idempotent (set overwrites, onfetchIssues clears+repopulates), so
    // React strict-mode's mount→unmount→mount double-run is harmless: the first
    // (discarded) run bails before setState, the second run does the real work.
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);

    void (async () => {
      try {
        const settings = await anchorService.getSettings(anchor);
        const resolvedProjectId = settings.project;
        const resolvedSlug = settings.workspace_detail?.slug ?? "";
        if (!resolvedProjectId) throw new Error("Published project has no project id");

        const [states, sections, members, issuesResponse, relations] = await Promise.all([
          anchorService.getStates(anchor),
          anchorService.getSections(anchor),
          anchorService.getMembers(anchor),
          anchorService.getIssues(anchor),
          anchorService.getRelations(anchor),
        ]);
        if (cancelled) return;

        // Populate the dependency stores first so the issue store has colours,
        // swimlane columns, and avatars to read once its ids land.
        runInAction(() => {
          // The public states payload omits project_id, but the gantt block's status
          // colour reads `getProjectStates(projectId)` (filtered by state.project_id),
          // so add it back here — otherwise every bar falls back to the grey default.
          states.forEach((state) => set(stateStore.stateMap, [state.id], { ...state, project_id: resolvedProjectId }));
          // getProjectStates is gated on fetchedMap; mark the project fetched or it
          // returns undefined and every bar stays grey.
          set(stateStore.fetchedMap, [resolvedProjectId], true);

          sections.forEach((section) =>
            set(sectionStore.sectionMap, [section.id], {
              ...section,
              project_id: resolvedProjectId,
              workspace_id: settings.workspace_detail?.id ?? "",
              is_archived: false,
            })
          );
          set(sectionStore.fetchedMap, [resolvedProjectId], true);

          members.forEach((member) => {
            const lite: IUserLite = {
              id: member.member,
              display_name: member.member__display_name,
              avatar_url: member.member__avatar ?? "",
              first_name: "",
              last_name: "",
              is_bot: false,
            };
            set(memberStore.memberMap, [member.member], lite);
          });
        });

        // Issues: feed the public response straight into the store's fetch seam.
        // `onfetchIssues` lives on the base issues store but isn't surfaced on the
        // narrow `IProjectIssues` hook type, so reach it via the base interface.
        (issues as unknown as TIssueStoreFetchSeam).onfetchIssues(
          issuesResponse,
          { canGroup: false, perPageCount: 100 },
          resolvedSlug,
          resolvedProjectId,
          undefined,
          true
        );

        // Relations AFTER issues (overrides the empty entries onfetchIssues seeds).
        if (Array.isArray(relations) && relations.length > 0) {
          extractRelationsFromIssues(relations as unknown as TIssue[]);
        }

        if (cancelled) return;
        setProjectId(resolvedProjectId);
        setWorkspaceSlug(resolvedSlug);
        setProjectName(settings.project_details?.name);
        setIsLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        const message =
          (e as { data?: { error?: string } })?.data?.error ??
          (e instanceof Error ? e.message : "Unable to load timeline");
        setError(message);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [anchor, anchorService, issues, stateStore, sectionStore, memberStore, extractRelationsFromIssues]);

  return { isLoading, error, projectId, workspaceSlug, projectName };
}
