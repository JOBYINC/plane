/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { ProjectSettingsFieldList } from "@/components/work-item-fields";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { FieldsProjectSettingsHeader } from "./header";

function FieldsSettingsPage() {
  // store hooks
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();

  const pageTitle = currentProjectDetails?.name ? `${currentProjectDetails?.name} - Fields` : undefined;

  // derived values
  const canViewProjectSettings = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  if (workspaceUserInfo && !canViewProjectSettings) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<FieldsProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <div className="size-full">
        <ProjectSettingsFieldList />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(FieldsSettingsPage);
