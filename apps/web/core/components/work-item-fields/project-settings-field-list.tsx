/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Loader } from "@plane/ui";
// hooks
import { useWorkItemField } from "@/hooks/store/use-work-item-field";
import { useUserPermissions } from "@/hooks/store/user";
// components
import { SettingsHeading } from "../settings/heading";
import { CreateUpdateFieldInline } from "./create-update-field-inline";
import { FieldListItem } from "./field-list-item";

export const ProjectSettingsFieldList = observer(function ProjectSettingsFieldList() {
  // router
  const { workspaceSlug, projectId } = useParams();
  // store
  const { getProjectFields, fetchProjectFields } = useWorkItemField();
  const { allowPermissions } = useUserPermissions();
  // i18n
  const { t } = useTranslation();
  // local state
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const ws = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";

  const isEditable = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const fields = getProjectFields(pid);
  // Soft-deleted fields (is_active=false) are hidden — there is no restore
  // entry, so deletion is effectively permanent from the UI.
  const visibleFields = fields?.filter((f) => f.is_active);

  useEffect(() => {
    if (!ws || !pid) return;
    let cancelled = false;
    setIsLoading(true);
    fetchProjectFields(ws, pid).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ws, pid, fetchProjectFields]);

  return (
    <div className="flex flex-col gap-4 py-2">
      <SettingsHeading
        title={t("project_settings.custom_fields.heading")}
        description={t("project_settings.custom_fields.description")}
        control={
          isEditable ? (
            <Button
              variant="primary"
              size="sm"
              prependIcon={<Plus className="size-3.5" />}
              onClick={() => setShowCreateForm(true)}
              disabled={showCreateForm}
            >
              {t("project_settings.custom_fields.new_field")}
            </Button>
          ) : undefined
        }
      />

      {showCreateForm && <CreateUpdateFieldInline onClose={() => setShowCreateForm(false)} />}

      {isLoading && !fields ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="56px" />
          <Loader.Item height="56px" />
          <Loader.Item height="56px" />
        </Loader>
      ) : !visibleFields || visibleFields.length === 0 ? (
        !showCreateForm && (
          <p className="py-8 text-center text-14 text-tertiary">{t("project_settings.custom_fields.empty")}</p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {visibleFields.map((field) => (
            <FieldListItem key={field.id} field={field} isEditable={isEditable} />
          ))}
        </div>
      )}
    </div>
  );
});
