/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ContentWrapper } from "@plane/ui";
// hooks
import { useHome } from "@/hooks/store/use-home";
import { useUser } from "@/hooks/store/user";
// plane web imports
import { HomePeekOverviewsRoot } from "@/plane-web/components/home";
// local imports
import { DashboardWidgets } from "./home-dashboard-widgets";
import { UserGreetingsView } from "./user-greetings";

export const WorkspaceHomeView = observer(function WorkspaceHomeView() {
  // store hooks
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const { fetchWidgets } = useHome();

  useSWR(
    workspaceSlug ? `HOME_DASHBOARD_WIDGETS_${workspaceSlug}` : null,
    workspaceSlug ? () => fetchWidgets(workspaceSlug?.toString()) : null,
    {
      revalidateIfStale: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  // TODO: refactor loader implementation
  return (
    <>
      <HomePeekOverviewsRoot />
      <ContentWrapper className="mx-auto scrollbar-hide gap-6 bg-surface-1 px-page-x">
        <div className="mx-auto w-full max-w-[800px]">
          {currentUser && <UserGreetingsView user={currentUser} />}
          <DashboardWidgets />
        </div>
      </ContentWrapper>
    </>
  );
});
