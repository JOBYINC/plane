/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssuesStoreType } from "@plane/types";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { BaseGanttRoot } from "@/components/issues/issue-layouts/gantt";
// hooks
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
// local
import { useEmbedTimelineData } from "./use-embed-timeline-data";

/**
 * Public, read-only Timeline embed (`/embed/timeline/:anchor`).
 *
 * Renders the exact same `BaseGanttRoot` as the authed project Timeline — section
 * swimlanes, status colours, due-date order, dependency arrows — but driven by the
 * public anchor API and with no session (see `app/provider.tsx` for the minimal
 * provider this route gets). Designed to be iframed into hub.joby.com launch pages.
 */
const EmbedTimelinePage = observer(function EmbedTimelinePage() {
  const { anchor } = useParams();
  const anchorStr = anchor?.toString() ?? "";
  const { isLoading, error, projectId, workspaceSlug } = useEmbedTimelineData(anchorStr);

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas px-6 text-center">
        <p className="text-sm text-custom-text-300">{error}</p>
      </div>
    );
  }

  if (isLoading || !projectId) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas">
        <LogoSpinner />
      </div>
    );
  }

  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.PROJECT}>
      <div className="h-screen w-full overflow-hidden bg-canvas">
        <BaseGanttRoot isEmbed projectId={projectId} workspaceSlug={workspaceSlug} />
      </div>
    </IssuesStoreContext.Provider>
  );
});

export default EmbedTimelinePage;
