/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode, SyntheticEvent } from "react";
import { useCallback, useMemo } from "react";
import { xor } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Paperclip } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { LinkIcon, StartDatePropertyIcon, ViewsIcon, DueDatePropertyIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, TIssuePriorities } from "@plane/types";
import {
  cn,
  getDate,
  renderFormattedDate,
  renderFormattedPayloadDate,
  generateWorkItemLink,
  shouldHighlightIssueDueDate,
} from "@plane/utils";
// dropdowns
import { CycleDropdown } from "@/components/dropdowns/cycle";
import { DateDropdown } from "@/components/dropdowns/date";
import { EstimateDropdown } from "@/components/dropdowns/estimate";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useLabel } from "@/hooks/store/use-label";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useAppRouter } from "@/hooks/use-app-router";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { usePlatformOS } from "@/hooks/use-platform-os";
// sibling
import { IssuePropertyLabels } from "../../properties/labels";
import type { TListColumnKey } from "./list-columns";

export type TIssueCellProps = {
  issue: TIssue;
  updateIssue?: (projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>;
  isReadOnly: boolean;
  isEpic?: boolean;
};

const stopPropagation = (e: SyntheticEvent) => {
  e.stopPropagation();
  e.preventDefault();
};

const Wrap = ({ children, className }: { children?: ReactNode; className?: string }) => (
  // Click/focus handlers only stop bubbling so the row peek-overview doesn't trigger
  // when the user interacts with a dropdown inside this cell. The cell itself is not
  // interactive; the dropdown is.
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
  <div className={cn("flex h-5 items-center", className)} onFocusCapture={stopPropagation} onClick={stopPropagation}>
    {children}
  </div>
);

export const StateCell = observer(function StateCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const handleState = (stateId: string) => updateIssue?.(issue.project_id, issue.id, { state_id: stateId });
  if (!issue.project_id) return null;
  return (
    <Wrap>
      <StateDropdown
        buttonContainerClassName="truncate max-w-full"
        value={issue.state_id}
        onChange={handleState}
        projectId={issue.project_id}
        disabled={isReadOnly}
        buttonVariant="border-with-text"
        renderByDefault={isMobile}
        showTooltip
      />
    </Wrap>
  );
});

export const PriorityCell = observer(function PriorityCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const handlePriority = (value: TIssuePriorities) => updateIssue?.(issue.project_id, issue.id, { priority: value });
  return (
    <Wrap>
      <PriorityDropdown
        value={issue?.priority}
        onChange={handlePriority}
        disabled={isReadOnly}
        buttonVariant="border-with-text"
        renderByDefault={isMobile}
        showTooltip
      />
    </Wrap>
  );
});

export const DueDateCell = observer(function DueDateCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { getStateById } = useProjectState();
  const stateDetails = getStateById(issue.state_id);
  const minDate = getDate(issue.start_date);
  const handleTargetDate = (date: Date | null) =>
    updateIssue?.(issue.project_id, issue.id, {
      target_date: date ? renderFormattedPayloadDate(date) : null,
    });
  return (
    <Wrap>
      <DateDropdown
        value={issue?.target_date ?? null}
        onChange={handleTargetDate}
        minDate={minDate}
        placeholder={t("common.order_by.due_date")}
        icon={<DueDatePropertyIcon className="h-3 w-3 shrink-0" />}
        buttonVariant={issue.target_date ? "border-with-text" : "border-without-text"}
        buttonClassName={
          shouldHighlightIssueDueDate(issue.target_date, stateDetails?.group) ? "text-danger-primary" : ""
        }
        clearIconClassName="text-primary!"
        optionsClassName="z-10"
        disabled={isReadOnly}
        renderByDefault={isMobile}
        showTooltip
        labelClassName="text-caption-sm-regular"
      />
    </Wrap>
  );
});

export const StartDateCell = observer(function StartDateCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const maxDate = getDate(issue.target_date);
  const handleStartDate = (date: Date | null) =>
    updateIssue?.(issue.project_id, issue.id, {
      start_date: date ? renderFormattedPayloadDate(date) : null,
    });
  return (
    <Wrap>
      <DateDropdown
        value={issue.start_date ?? null}
        onChange={handleStartDate}
        maxDate={maxDate}
        placeholder={t("common.order_by.start_date")}
        icon={<StartDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
        buttonVariant={issue.start_date ? "border-with-text" : "border-without-text"}
        optionsClassName="z-10"
        disabled={isReadOnly}
        renderByDefault={isMobile}
        showTooltip
        labelClassName="text-caption-sm-regular"
      />
    </Wrap>
  );
});

export const AssigneeCell = observer(function AssigneeCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const handleAssignee = (ids: string[]) => updateIssue?.(issue.project_id, issue.id, { assignee_ids: ids });
  if (!issue.project_id) return null;
  return (
    <Wrap>
      <MemberDropdown
        projectId={issue.project_id}
        expandToWorkspace
        value={issue?.assignee_ids}
        onChange={handleAssignee}
        disabled={isReadOnly}
        multiple
        buttonVariant={issue.assignee_ids?.length > 0 ? "transparent-without-text" : "border-without-text"}
        buttonClassName={issue.assignee_ids?.length > 0 ? "hover:bg-transparent px-0" : ""}
        showTooltip={issue?.assignee_ids?.length === 0}
        placeholder={t("common.assignees")}
        optionsClassName="z-10"
        tooltipContent=""
        renderByDefault={isMobile}
      />
    </Wrap>
  );
});

export const LabelsCell = observer(function LabelsCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const { labelMap } = useLabel();
  const handleLabel = (ids: string[]) => updateIssue?.(issue.project_id, issue.id, { label_ids: ids });
  const defaultLabelOptions = issue?.label_ids?.map((id) => labelMap[id]) || [];
  return (
    <Wrap>
      <IssuePropertyLabels
        projectId={issue?.project_id || null}
        value={issue?.label_ids || []}
        defaultOptions={defaultLabelOptions}
        onChange={handleLabel}
        disabled={isReadOnly}
        renderByDefault={isMobile}
        hideDropdownArrow
        maxRender={3}
      />
    </Wrap>
  );
});

export const ModulesCell = observer(function ModulesCell(props: TIssueCellProps) {
  const { issue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const { workspaceSlug } = useParams();
  const storeType = useIssueStoreType();
  const {
    issues: { changeModulesInIssue },
  } = useIssues(storeType);

  const issueOperations = useMemo(
    () => ({
      addModulesToIssue: async (moduleIds: string[]) => {
        if (!workspaceSlug || !issue.project_id || !issue.id) return;
        await changeModulesInIssue?.(workspaceSlug.toString(), issue.project_id, issue.id, moduleIds, []);
      },
      removeModulesFromIssue: async (moduleIds: string[]) => {
        if (!workspaceSlug || !issue.project_id || !issue.id) return;
        await changeModulesInIssue?.(workspaceSlug.toString(), issue.project_id, issue.id, [], moduleIds);
      },
    }),
    [workspaceSlug, issue, changeModulesInIssue]
  );

  const handleModule = useCallback(
    (moduleIds: string[] | null) => {
      if (!issue || !issue.module_ids || !moduleIds) return;
      const updatedModuleIds = xor(issue.module_ids, moduleIds);
      const modulesToAdd: string[] = [];
      const modulesToRemove: string[] = [];
      for (const moduleId of updatedModuleIds)
        if (issue.module_ids.includes(moduleId)) modulesToRemove.push(moduleId);
        else modulesToAdd.push(moduleId);
      if (modulesToAdd.length > 0) issueOperations.addModulesToIssue(modulesToAdd);
      if (modulesToRemove.length > 0) issueOperations.removeModulesFromIssue(modulesToRemove);
    },
    [issueOperations, issue]
  );

  if (!issue.project_id) return null;
  return (
    <Wrap>
      <ModuleDropdown
        buttonContainerClassName="truncate max-w-full"
        projectId={issue.project_id}
        value={issue?.module_ids ?? []}
        onChange={handleModule}
        disabled={isReadOnly}
        renderByDefault={isMobile}
        multiple
        buttonVariant="border-with-text"
        showCount
        showTooltip
      />
    </Wrap>
  );
});

export const CycleCell = observer(function CycleCell(props: TIssueCellProps) {
  const { issue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const { workspaceSlug } = useParams();
  const storeType = useIssueStoreType();
  const {
    issues: { addCycleToIssue, removeCycleFromIssue },
  } = useIssues(storeType);

  const handleCycle = useCallback(
    async (cycleId: string | null) => {
      if (!workspaceSlug || !issue.project_id || !issue.id) return;
      if (issue.cycle_id === cycleId) return;
      if (cycleId) await addCycleToIssue?.(workspaceSlug.toString(), issue.project_id, cycleId, issue.id);
      else await removeCycleFromIssue?.(workspaceSlug.toString(), issue.project_id, issue.id);
    },
    [workspaceSlug, issue, addCycleToIssue, removeCycleFromIssue]
  );

  if (!issue.project_id) return null;
  return (
    <Wrap>
      <CycleDropdown
        buttonContainerClassName="truncate max-w-full"
        projectId={issue.project_id}
        value={issue?.cycle_id}
        onChange={handleCycle}
        disabled={isReadOnly}
        buttonVariant="border-with-text"
        renderByDefault={isMobile}
        showTooltip
      />
    </Wrap>
  );
});

export const EstimateCell = observer(function EstimateCell(props: TIssueCellProps) {
  const { issue, updateIssue, isReadOnly } = props;
  const { isMobile } = usePlatformOS();
  const handleEstimate = (value: string | undefined) =>
    updateIssue?.(issue.project_id, issue.id, { estimate_point: value });
  if (!issue.project_id) return null;
  return (
    <Wrap>
      <EstimateDropdown
        value={issue.estimate_point ?? undefined}
        onChange={handleEstimate}
        projectId={issue.project_id}
        disabled={isReadOnly}
        buttonVariant="border-with-text"
        renderByDefault={isMobile}
        showTooltip
      />
    </Wrap>
  );
});

const CountChip = ({
  icon,
  count,
  tooltipHeading,
  onClick,
  clickable,
}: {
  icon: ReactNode;
  count: number;
  tooltipHeading: string;
  onClick?: () => void;
  clickable?: boolean;
}) => {
  const { isMobile } = usePlatformOS();
  return (
    <Tooltip tooltipHeading={tooltipHeading} tooltipContent={`${count}`} isMobile={isMobile} renderByDefault={false}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onFocusCapture={stopPropagation}
        onClick={(e) => {
          stopPropagation(e);
          onClick?.();
        }}
        className={cn(
          "flex h-5 flex-shrink-0 items-center justify-center gap-2 overflow-hidden rounded-sm border-[0.5px] border-strong px-2.5 py-1",
          {
            "cursor-pointer hover:bg-layer-1": clickable,
          }
        )}
      >
        {icon}
        <div className="text-caption-sm-regular">{count}</div>
      </div>
    </Tooltip>
  );
};

export const SubIssueCountCell = observer(function SubIssueCountCell(props: TIssueCellProps) {
  const { issue, isEpic } = props;
  const { t } = useTranslation();
  const { getProjectById } = useProject();
  const router = useAppRouter();
  const { workspaceSlug } = useParams();
  const projectDetails = getProjectById(issue.project_id);
  const subIssueCount = issue?.sub_issues_count ?? 0;
  if (!subIssueCount) return <Wrap />;
  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug?.toString(),
    projectId: issue?.project_id,
    issueId: issue?.id,
    projectIdentifier: projectDetails?.identifier,
    sequenceId: issue?.sequence_id,
    isArchived: !!issue?.archived_at,
    isEpic,
  });
  return (
    <Wrap>
      <CountChip
        icon={<ViewsIcon className="h-3 w-3 flex-shrink-0" strokeWidth={2} />}
        count={subIssueCount}
        tooltipHeading={t("common.sub_work_items")}
        clickable
        onClick={() => router.push(`${workItemLink}#sub-issues`)}
      />
    </Wrap>
  );
});

export const AttachmentCountCell = observer(function AttachmentCountCell(props: TIssueCellProps) {
  const { issue } = props;
  const { t } = useTranslation();
  const count = issue.attachment_count ?? 0;
  if (!count) return <Wrap />;
  return (
    <Wrap>
      <CountChip
        icon={<Paperclip className="h-3 w-3 flex-shrink-0" strokeWidth={2} />}
        count={count}
        tooltipHeading={t("common.attachments")}
      />
    </Wrap>
  );
});

export const LinkCell = observer(function LinkCell(props: TIssueCellProps) {
  const { issue } = props;
  const { t } = useTranslation();
  const count = issue.link_count ?? 0;
  if (!count) return <Wrap />;
  return (
    <Wrap>
      <CountChip
        icon={<LinkIcon className="h-3 w-3 flex-shrink-0" strokeWidth={2} />}
        count={count}
        tooltipHeading={t("common.links")}
      />
    </Wrap>
  );
});

const ReadOnlyDateCell = ({ value }: { value: string | null | undefined }) => (
  <Wrap>
    <span className="truncate text-caption-sm-regular text-tertiary">{value ? renderFormattedDate(value) : ""}</span>
  </Wrap>
);

export const CreatedOnCell = observer(function CreatedOnCell(props: TIssueCellProps) {
  return <ReadOnlyDateCell value={props.issue.created_at} />;
});

export const UpdatedOnCell = observer(function UpdatedOnCell(props: TIssueCellProps) {
  return <ReadOnlyDateCell value={props.issue.updated_at} />;
});

export const CELL_BY_COLUMN: Record<TListColumnKey, React.ComponentType<TIssueCellProps>> = {
  state: StateCell,
  priority: PriorityCell,
  due_date: DueDateCell,
  start_date: StartDateCell,
  assignee: AssigneeCell,
  labels: LabelsCell,
  modules: ModulesCell,
  cycle: CycleCell,
  estimate: EstimateCell,
  sub_issue_count: SubIssueCountCell,
  attachment_count: AttachmentCountCell,
  link: LinkCell,
  created_on: CreatedOnCell,
  updated_on: UpdatedOnCell,
};
