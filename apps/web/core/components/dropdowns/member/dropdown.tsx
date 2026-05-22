/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local imports
import { MemberDropdownBase } from "./base";
import type { MemberDropdownProps } from "./types";

type TMemberDropdownProps = {
  icon?: LucideIcon;
  memberIds?: string[];
  onClose?: () => void;
  optionsClassName?: string;
  projectId?: string;
  renderByDefault?: boolean;
  // Asana-style task-assignee mode: even when a projectId is supplied, show
  // every workspace member instead of restricting to project members.
  // Non-members get auto-added to the project on assignment (handled by
  // IssueCreateSerializer.validate() on the backend).
  expandToWorkspace?: boolean;
} & MemberDropdownProps;

export const MemberDropdown = observer(function MemberDropdown(props: TMemberDropdownProps) {
  const { memberIds: propsMemberIds, projectId, expandToWorkspace } = props;
  // router params
  const { workspaceSlug } = useParams();
  // store hooks
  const {
    getUserDetails,
    project: { getProjectMemberIds, fetchProjectMembers },
    workspace: { workspaceMemberIds },
  } = useMember();

  const memberIds = propsMemberIds
    ? propsMemberIds
    : expandToWorkspace
      ? workspaceMemberIds
      : projectId
        ? getProjectMemberIds(projectId, false)
        : workspaceMemberIds;

  const onDropdownOpen = () => {
    // Lazy project-member fetch only fires in the project-scoped path
    // (no propsMemberIds, no expandToWorkspace). In expandToWorkspace
    // mode memberIds is workspaceMemberIds, which is hydrated by the
    // auth layout, so we deliberately don't touch project members here.
    if (!memberIds && projectId && workspaceSlug) fetchProjectMembers(workspaceSlug.toString(), projectId);
  };

  return (
    <MemberDropdownBase
      {...props}
      getUserDetails={getUserDetails}
      memberIds={memberIds ?? []}
      onDropdownOpen={onDropdownOpen}
    />
  );
});
