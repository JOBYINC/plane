/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TWorkItemField, TWorkItemFieldOption, TWorkItemFieldValue, TWorkItemFieldValueRow } from "@plane/types";
import { APIService } from "@/services/api.service";

export class WorkItemFieldService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getProjectFields(workspaceSlug: string, projectId: string): Promise<TWorkItemField[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createField(workspaceSlug: string, projectId: string, data: Partial<TWorkItemField>): Promise<TWorkItemField> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateField(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemField>
  ): Promise<TWorkItemField> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteField(workspaceSlug: string, projectId: string, fieldId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getFieldOptions(workspaceSlug: string, projectId: string, fieldId: string): Promise<TWorkItemFieldOption[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/options/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createOption(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemFieldOption>
  ): Promise<TWorkItemFieldOption> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/options/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateOption(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<TWorkItemFieldOption>
  ): Promise<TWorkItemFieldOption> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/options/${optionId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOption(workspaceSlug: string, projectId: string, fieldId: string, optionId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/fields/${fieldId}/options/${optionId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectFieldValues(
    workspaceSlug: string,
    projectId: string,
    issueIds?: string[]
  ): Promise<Record<string, Record<string, TWorkItemFieldValue>>> {
    const query = issueIds && issueIds.length > 0 ? `?issue_ids=${issueIds.join(",")}` : "";
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-field-values/${query}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueFieldValues(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<TWorkItemFieldValueRow[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/field-values/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async upsertValue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    fieldId: string,
    value: TWorkItemFieldValue
  ): Promise<TWorkItemFieldValueRow> {
    return this.put(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/field-values/${fieldId}/`,
      { value }
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async clearValue(workspaceSlug: string, projectId: string, issueId: string, fieldId: string): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/field-values/${fieldId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
