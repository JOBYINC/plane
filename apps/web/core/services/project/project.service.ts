/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  GithubRepositoriesResponse,
  IProjectUserPropertiesResponse,
  ISearchIssueResponse,
  TProjectAnalyticsCount,
  TProjectAnalyticsCountParams,
  TProjectIssuesSearchParams,
} from "@plane/types";
// helpers
// plane web types
import type { TProject, TPartialProject } from "@/plane-web/types";
// services
import { APIService } from "@/services/api.service";

export class ProjectService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async createProject(workspaceSlug: string, data: Partial<TProject>): Promise<TProject> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async checkProjectIdentifierAvailability(workspaceSlug: string, data: string): Promise<any> {
    return this.get(`/api/workspaces/${workspaceSlug}/project-identifiers`, {
      params: {
        name: data,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectsLite(workspaceSlug: string): Promise<TPartialProject[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjects(workspaceSlug: string): Promise<TProject[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/details/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProject(workspaceSlug: string, projectId: string): Promise<TProject> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  /**
   * Returns the requesting user's private personal ("My Tasks") project for
   * the workspace, lazily creating it server-side on first call. The bucket
   * is a fully-functional but hidden project (excluded from normal project
   * lists), reused so project-less tasks need no schema change.
   */
  async getPersonalProject(workspaceSlug: string): Promise<TProject> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/personal/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  /**
   * Returns workspace-canonical template projects (``is_template=True``).
   * Server filters by the same permission shape as ``getProjects`` —
   * guests see only templates they're a member of, members additionally
   * see public ones. Templates are excluded from ``getProjects`` so the
   * two lists are disjoint and can be rendered as separate sidebar groups.
   */
  async getTemplateProjects(workspaceSlug: string): Promise<TProject[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/templates/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Deep-clones a project via the server-side duplicate endpoint. See
   * ``ProjectDuplicateEndpoint`` for the full clone matrix (cycles,
   * modules, custom fields, issues, blocked_by relations, etc.). All
   * body fields are optional; ``rebump_target_dates_by_days`` shifts
   * issue dates, ``rebump_cycle_windows_by_days`` shifts cycle windows,
   * and ``override_custom_field_values`` lets the caller override a
   * specific field's value on every cloned issue.
   */
  async duplicateProject(
    workspaceSlug: string,
    projectId: string,
    body: {
      name?: string;
      identifier?: string;
      external_source?: string | null;
      external_id?: string | null;
      rebump_target_dates_by_days?: number;
      rebump_cycle_windows_by_days?: number;
      // ISO date (YYYY-MM-DD) — re-anchors the clone's timeline so the
      // source's earliest date lands here, preserving the overall span.
      // Overrides the rebump_* deltas when set.
      anchor_start_date?: string;
      override_custom_field_values?: Record<string, unknown>;
      // when true the clone is created as a workspace template ("Save as
      // template"); default false keeps create-from-template producing a
      // normal project
      is_template?: boolean;
      // 0 = Secret (private — only members see it), 2 = Public (whole
      // workspace sees it). If omitted, the server defaults a template
      // clone to 0 (Private); a non-template clone inherits the source's
      // network. See api/views/project_duplicate.py _clone_project_record.
      network?: 0 | 2;
    }
  ): Promise<TProject> {
    return this.post(`/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/duplicate/`, body)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectAnalyticsCount(
    workspaceSlug: string,
    params?: TProjectAnalyticsCountParams
  ): Promise<TProjectAnalyticsCount[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/project-stats/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateProject(workspaceSlug: string, projectId: string, data: Partial<TProject>): Promise<TProject> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteProject(workspaceSlug: string, projectId: string): Promise<any> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // User Properties
  async getProjectUserProperties(workspaceSlug: string, projectId: string): Promise<IProjectUserPropertiesResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-properties/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateProjectUserProperties(
    workspaceSlug: string,
    projectId: string,
    data: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-properties/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getGithubRepositories(url: string): Promise<GithubRepositoriesResponse> {
    return this.request({
      method: "get",
      url,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async syncGithubRepository(
    workspaceSlug: string,
    projectId: string,
    workspaceIntegrationId: string,
    data: {
      name: string;
      owner: string;
      repository_id: string;
      url: string;
    }
  ): Promise<any> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/workspace-integrations/${workspaceIntegrationId}/github-repository-sync/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectGithubRepository(workspaceSlug: string, projectId: string, integrationId: string): Promise<any> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/workspace-integrations/${integrationId}/github-repository-sync/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getUserProjectFavorites(workspaceSlug: string): Promise<any[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/user-favorite-projects/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addProjectToFavorites(workspaceSlug: string, project: string): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/user-favorite-projects/`, { project })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeProjectFromFavorites(workspaceSlug: string, projectId: string): Promise<any> {
    return this.delete(`/api/workspaces/${workspaceSlug}/user-favorite-projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async projectIssuesSearch(
    workspaceSlug: string,
    projectId: string,
    params: TProjectIssuesSearchParams
  ): Promise<ISearchIssueResponse[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/search-issues/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
