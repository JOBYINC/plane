/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { CalendarDays } from "lucide-react";
// hooks
import { useTranslation } from "@plane/i18n";
import { renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
// helpers

type TIssueTargetDateActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueTargetDateActivity = observer(function IssueTargetDateActivity(props: TIssueTargetDateActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<CalendarDays size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.new_value ? `${t("issue_activity.target_date_set")} ` : `${t("issue_activity.target_date_removed")} `}
        {activity.new_value && (
          <>
            <span className="font-medium text-primary">{renderFormattedDate(activity.new_value)}</span>
          </>
        )}
        {showIssue &&
          (activity.new_value ? ` ${t("issue_activity.common.for")} ` : ` ${t("issue_activity.common.from")} `)}
        {showIssue && <IssueLink activityId={activityId} />}.
      </>
    </IssueActivityBlockComponent>
  );
});
