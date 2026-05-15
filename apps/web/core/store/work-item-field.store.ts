/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, sortBy } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TWorkItemField, TWorkItemFieldOption } from "@plane/types";
import { WorkItemFieldService } from "@/services/work-item-field.service";
import type { CoreRootStore } from "./root.store";

export interface IWorkItemFieldStore {
  // observables
  fieldMap: Record<string, TWorkItemField>;
  fetchedMap: Record<string, boolean>;
  // computed
  projectFields: TWorkItemField[] | undefined;
  // computed actions
  getProjectFields: (projectId: string | undefined | null) => TWorkItemField[] | undefined;
  getFieldById: (fieldId: string) => TWorkItemField | null;
  // fetch
  fetchProjectFields: (workspaceSlug: string, projectId: string) => Promise<TWorkItemField[]>;
  // field crud
  createField: (workspaceSlug: string, projectId: string, data: Partial<TWorkItemField>) => Promise<TWorkItemField>;
  updateField: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemField>
  ) => Promise<TWorkItemField>;
  deleteField: (workspaceSlug: string, projectId: string, fieldId: string) => Promise<void>;
  // option crud
  createOption: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemFieldOption>
  ) => Promise<TWorkItemFieldOption>;
  updateOption: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<TWorkItemFieldOption>
  ) => Promise<TWorkItemFieldOption>;
  deleteOption: (workspaceSlug: string, projectId: string, fieldId: string, optionId: string) => Promise<void>;
}

export class WorkItemFieldStore implements IWorkItemFieldStore {
  // observables
  fieldMap: Record<string, TWorkItemField> = {};
  fetchedMap: Record<string, boolean> = {};
  // root store
  rootStore: CoreRootStore;
  // services
  workItemFieldService: WorkItemFieldService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      fieldMap: observable,
      fetchedMap: observable,
      projectFields: computed,
      fetchProjectFields: action,
      createField: action,
      updateField: action,
      deleteField: action,
      createOption: action,
      updateOption: action,
      deleteOption: action,
    });
    this.rootStore = _rootStore;
    this.workItemFieldService = new WorkItemFieldService();
  }

  /** Fields for the project currently in the router, sorted by sort_order. */
  get projectFields(): TWorkItemField[] | undefined {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return undefined;
    return this.getProjectFields(projectId);
  }

  getProjectFields = computedFn((projectId: string | undefined | null): TWorkItemField[] | undefined => {
    if (!projectId || !this.fetchedMap[projectId]) return undefined;
    return sortBy(
      Object.values(this.fieldMap).filter((field) => field?.project_id === projectId),
      "sort_order"
    );
  });

  getFieldById = computedFn((fieldId: string): TWorkItemField | null => this.fieldMap?.[fieldId] || null);

  fetchProjectFields = async (workspaceSlug: string, projectId: string): Promise<TWorkItemField[]> => {
    const response = await this.workItemFieldService.getProjectFields(workspaceSlug, projectId);
    runInAction(() => {
      response.forEach((field) => set(this.fieldMap, [field.id], field));
      set(this.fetchedMap, projectId, true);
    });
    return response;
  };

  createField = async (
    workspaceSlug: string,
    projectId: string,
    data: Partial<TWorkItemField>
  ): Promise<TWorkItemField> => {
    const response = await this.workItemFieldService.createField(workspaceSlug, projectId, data);
    runInAction(() => set(this.fieldMap, [response.id], response));
    return response;
  };

  updateField = async (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemField>
  ): Promise<TWorkItemField> => {
    const original = this.fieldMap[fieldId];
    try {
      runInAction(() => set(this.fieldMap, [fieldId], { ...original, ...data }));
      return await this.workItemFieldService.updateField(workspaceSlug, projectId, fieldId, data);
    } catch (error) {
      runInAction(() => set(this.fieldMap, [fieldId], original));
      throw error;
    }
  };

  deleteField = async (workspaceSlug: string, projectId: string, fieldId: string): Promise<void> => {
    const original = this.fieldMap[fieldId];
    try {
      // Server soft-archives (is_active=false); mirror locally, keep in map.
      runInAction(() => set(this.fieldMap, [fieldId], { ...original, is_active: false }));
      await this.workItemFieldService.deleteField(workspaceSlug, projectId, fieldId);
    } catch (error) {
      runInAction(() => set(this.fieldMap, [fieldId], original));
      throw error;
    }
  };

  createOption = async (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<TWorkItemFieldOption>
  ): Promise<TWorkItemFieldOption> => {
    const response = await this.workItemFieldService.createOption(workspaceSlug, projectId, fieldId, data);
    runInAction(() => {
      const field = this.fieldMap[fieldId];
      if (field) {
        set(this.fieldMap, [fieldId], { ...field, options: [...field.options, response] });
      }
    });
    return response;
  };

  updateOption = async (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<TWorkItemFieldOption>
  ): Promise<TWorkItemFieldOption> => {
    const response = await this.workItemFieldService.updateOption(workspaceSlug, projectId, fieldId, optionId, data);
    runInAction(() => {
      const field = this.fieldMap[fieldId];
      if (field) {
        const options = field.options.map((opt) => (opt.id === optionId ? response : opt));
        set(this.fieldMap, [fieldId], { ...field, options });
      }
    });
    return response;
  };

  deleteOption = async (workspaceSlug: string, projectId: string, fieldId: string, optionId: string): Promise<void> => {
    await this.workItemFieldService.deleteOption(workspaceSlug, projectId, fieldId, optionId);
    runInAction(() => {
      const field = this.fieldMap[fieldId];
      if (field) {
        // Server archives the option (is_active=false); existing values may
        // still reference it, so keep it in the array, just flag inactive.
        const options = field.options.map((opt) => (opt.id === optionId ? { ...opt, is_active: false } : opt));
        set(this.fieldMap, [fieldId], { ...field, options });
      }
    });
  };
}
