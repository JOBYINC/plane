/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Navigate } from "react-router";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function ProfileIndexRedirect({ params }: Route.ComponentProps) {
  const { workspaceSlug, userId } = params;
  const { allowPermissions } = useUserPermissions();

  // Authorized users (admin/member) land on the Assigned board, which is
  // the actionable view; workspace guests fall back to the Summary view
  // because the Assigned view requires workspace-level read permissions.
  const isAuthorized = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const target = isAuthorized ? "assigned" : "summary";

  return <Navigate to={`/${workspaceSlug}/profile/${userId}/${target}`} replace />;
}

export default observer(ProfileIndexRedirect);
