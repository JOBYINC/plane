/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
// types
import type { TProjectSection } from "@/store/project/project-section.store";

/**
 * REST client for free-form Sections (docs/sections-design.md §5).
 *
 * Mirrors ProjectStateService intentionally — Sections are a parallel,
 * independent organizational axis. Nothing here ever touches State.
 */
export class ProjectSectionService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getSections(workspaceSlug: string, projectId: string): Promise<TProjectSection[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sections/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createSection(
    workspaceSlug: string,
    projectId: string,
    data: Partial<TProjectSection>
  ): Promise<TProjectSection> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sections/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async patchSection(
    workspaceSlug: string,
    projectId: string,
    sectionId: string,
    data: Partial<TProjectSection>
  ): Promise<TProjectSection> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sections/${sectionId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  /** DELETE soft-archives server-side (issues keep their section_id). */
  async deleteSection(workspaceSlug: string, projectId: string, sectionId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sections/${sectionId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  /**
   * Set or clear an issue's section. `sectionId = null` clears it.
   * Dedicated endpoint — never goes through the issue PATCH / State /
   * automation pipeline (§2, §5).
   */
  async setIssueSection(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    sectionId: string | null
  ): Promise<{ section_id: string | null }> {
    return this.put(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/section/`, {
      section_id: sectionId,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }
}
