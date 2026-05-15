/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { registerListColumnProvider } from "@/components/issues/issue-layouts/list/columns/list-columns";
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { buildCustomColumns } from "./use-custom-field-columns";

interface CustomFieldColumnsBridgeProps {
  workspaceSlug: string;
  projectId: string;
}

/**
 * Mount once inside the list layout (design §7, gated wiring edit #1).
 * Hydrates the project's fields + values, then registers a column provider
 * so the list view appends one column per active custom field. Renders
 * nothing. Unregisters on unmount.
 */
export const CustomFieldColumnsBridge = observer(function CustomFieldColumnsBridge(
  props: CustomFieldColumnsBridgeProps
) {
  const { workspaceSlug, projectId } = props;
  const { fetchProjectFields, fetchProjectFieldValues, getProjectFields } = useWorkItemField();

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    fetchProjectFields(workspaceSlug, projectId).catch(() => {});
    fetchProjectFieldValues(workspaceSlug, projectId).catch(() => {});
  }, [workspaceSlug, projectId, fetchProjectFields, fetchProjectFieldValues]);

  useEffect(() => {
    const unregister = registerListColumnProvider(() => buildCustomColumns(getProjectFields(projectId) ?? []));
    return unregister;
  }, [projectId, getProjectFields]);

  return null;
});
