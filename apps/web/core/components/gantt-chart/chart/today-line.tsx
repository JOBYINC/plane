/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
// helpers
import { getPositionFromDate } from "../views/helpers";

/**
 * Asana-style "today" marker: a thin vertical line at the current date,
 * spanning the full chart height. Mounted inside the items container so it
 * shares the chart's x-coordinate space and scrolls with the timeline.
 */
export const TimelineTodayLine = observer(function TimelineTodayLine() {
  const { currentViewData } = useTimeLineChartStore();

  if (!currentViewData?.data?.startDate) return null;
  const left = getPositionFromDate(currentViewData, new Date(), 0);
  if (!left) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-[3] w-px bg-[#E8384F]/60"
      style={{ left: `${left}px` }}
    />
  );
});
