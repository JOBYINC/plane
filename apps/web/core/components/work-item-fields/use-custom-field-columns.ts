/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkItemField, TWorkItemFieldType } from "@plane/types";
import type { TCustomListColumn } from "@/components/issues/issue-layouts/list/columns/list-columns";
import { CUSTOM_COLUMN_KEY_PREFIX } from "@/components/issues/issue-layouts/list/columns/list-columns";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";

const WIDTH_BY_TYPE: Record<TWorkItemFieldType, number> = {
  text: 180,
  number: 110,
  date: 140,
  single_select: 150,
  multi_select: 200,
  people: 180,
};

export function buildCustomColumns(fields: TWorkItemField[]): TCustomListColumn[] {
  return fields
    .filter((f) => f.is_active)
    .map((f) => ({
      key: `${CUSTOM_COLUMN_KEY_PREFIX}${f.id}`,
      width: WIDTH_BY_TYPE[f.field_type] ?? 150,
      label: f.name,
    }));
}

/** Active custom-field columns for a project, ready for registerListColumnProvider. */
export function useCustomFieldColumns(projectId: string | undefined | null): TCustomListColumn[] {
  const { getProjectFields } = useWorkItemField();
  const fields = getProjectFields(projectId) ?? [];
  return buildCustomColumns(fields);
}
