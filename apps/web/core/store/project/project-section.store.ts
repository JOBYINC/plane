/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, sortBy } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// services
import { ProjectSectionService } from "@/services/project/project-section.service";
// store
import type { CoreRootStore } from "@/store/root.store";

/**
 * A free-form organizational bucket within a project.
 *
 * Mirrors the backend `ProjectSection` (docs/sections-design.md §3/§6.3).
 * Intentionally carries NO State / workflow data — Sections are a
 * parallel, independent axis (§2 hard constraint). `workspace_id` is
 * included beyond the §6.3 sketch because the REST payload returns it
 * and workspace-scoped lookups will want it later.
 */
export type TProjectSection = {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  is_collapsed_default: boolean;
  is_archived: boolean;
};

export interface IProjectSectionStore {
  // observable
  sectionMap: Record<string, TProjectSection>;
  fetchedMap: Record<string, boolean>;
  // computed
  projectSections: TProjectSection[] | undefined;
  // computed actions
  getSections: (projectId: string | undefined | null) => TProjectSection[];
  getSectionById: (sectionId: string | undefined | null) => TProjectSection | null;
  // fetch
  fetchProjectSections: (workspaceSlug: string, projectId: string) => Promise<TProjectSection[]>;
  // crud
  createSection: (workspaceSlug: string, projectId: string, data: Partial<TProjectSection>) => Promise<TProjectSection>;
  renameSection: (
    workspaceSlug: string,
    projectId: string,
    sectionId: string,
    name: string
  ) => Promise<TProjectSection>;
  reorderSection: (
    workspaceSlug: string,
    projectId: string,
    sectionId: string,
    sortOrder: number
  ) => Promise<TProjectSection>;
  updateSection: (
    workspaceSlug: string,
    projectId: string,
    sectionId: string,
    data: Partial<TProjectSection>
  ) => Promise<TProjectSection>;
  archiveSection: (workspaceSlug: string, projectId: string, sectionId: string) => Promise<void>;
  setIssueSection: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    sectionId: string | null
  ) => Promise<{ section_id: string | null }>;
}

export class ProjectSectionStore implements IProjectSectionStore {
  // observables
  sectionMap: Record<string, TProjectSection> = {};
  fetchedMap: Record<string, boolean> = {};
  // root
  rootStore;
  // services
  projectSectionService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      sectionMap: observable,
      fetchedMap: observable,
      // computed
      projectSections: computed,
      // actions
      fetchProjectSections: action,
      createSection: action,
      renameSection: action,
      reorderSection: action,
      updateSection: action,
      archiveSection: action,
      setIssueSection: action,
    });

    this.rootStore = _rootStore;
    this.projectSectionService = new ProjectSectionService();
  }

  /** Active sections of the current route's project, ordered by sort_order. */
  get projectSections() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return;
    return this.getSections(projectId);
  }

  /**
   * Active (non-archived) sections of a project, ordered by sort_order.
   * Archived sections stay in the map (reversible — §10) but are excluded
   * here so pickers/grouping only see live buckets.
   */
  getSections = computedFn((projectId: string | undefined | null): TProjectSection[] => {
    if (!projectId) return [];
    return sortBy(
      Object.values(this.sectionMap).filter((section) => section?.project_id === projectId && !section?.is_archived),
      "sort_order"
    );
  });

  getSectionById = computedFn(
    (sectionId: string | undefined | null): TProjectSection | null =>
      (sectionId && this.sectionMap?.[sectionId]) || null
  );

  fetchProjectSections = async (workspaceSlug: string, projectId: string) =>
    await this.projectSectionService.getSections(workspaceSlug, projectId).then((response) => {
      runInAction(() => {
        response.forEach((section) => {
          set(this.sectionMap, [section.id], section);
        });
        set(this.fetchedMap, projectId, true);
      });
      return response;
    });

  createSection = async (workspaceSlug: string, projectId: string, data: Partial<TProjectSection>) =>
    await this.projectSectionService.createSection(workspaceSlug, projectId, data).then((response) => {
      runInAction(() => {
        set(this.sectionMap, [response.id], response);
      });
      return response;
    });

  /**
   * Generic optimistic patch — the single mutation path so rename /
   * reorder / collapse-default never drift apart (DRY). Rolls back the
   * exact prior snapshot on failure; never silently swallows the error.
   */
  updateSection = async (
    workspaceSlug: string,
    projectId: string,
    sectionId: string,
    data: Partial<TProjectSection>
  ) => {
    const original = this.sectionMap[sectionId];
    try {
      runInAction(() => {
        set(this.sectionMap, [sectionId], { ...original, ...data });
      });
      return await this.projectSectionService.patchSection(workspaceSlug, projectId, sectionId, data);
    } catch (error) {
      runInAction(() => {
        set(this.sectionMap, [sectionId], original);
      });
      throw error;
    }
  };

  renameSection = async (workspaceSlug: string, projectId: string, sectionId: string, name: string) =>
    this.updateSection(workspaceSlug, projectId, sectionId, { name });

  reorderSection = async (workspaceSlug: string, projectId: string, sectionId: string, sortOrder: number) =>
    this.updateSection(workspaceSlug, projectId, sectionId, { sort_order: sortOrder });

  /**
   * Soft-archive. Optimistically flips is_archived so the bucket drops
   * out of `getSections` immediately; the server DELETE only archives
   * (issues keep their section_id — §5). Rolls back on failure.
   */
  archiveSection = async (workspaceSlug: string, projectId: string, sectionId: string) => {
    const original = this.sectionMap[sectionId];
    if (!original) return;
    try {
      runInAction(() => {
        set(this.sectionMap, [sectionId], { ...original, is_archived: true });
      });
      await this.projectSectionService.deleteSection(workspaceSlug, projectId, sectionId);
    } catch (error) {
      runInAction(() => {
        set(this.sectionMap, [sectionId], original);
      });
      throw error;
    }
  };

  /**
   * Set/clear an issue's section via the dedicated endpoint. Pure
   * organizational move — never touches State (§2). The list/board's
   * existing drag machinery owns the issue-store-local update (step 5);
   * this is the network primitive other call sites (pickers) reuse.
   */
  setIssueSection = async (workspaceSlug: string, projectId: string, issueId: string, sectionId: string | null) =>
    await this.projectSectionService.setIssueSection(workspaceSlug, projectId, issueId, sectionId);
}
