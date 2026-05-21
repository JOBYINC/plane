/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
import { Plus, Trash2, Pencil, ChevronLeft, Zap, ToggleLeft, ToggleRight } from "lucide-react";

import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader } from "@plane/ui";

import { useMember } from "@/hooks/store/use-member";
import { useProjectState } from "@/hooks/store/use-project-state";
import {
  ProjectAutomationService,
  type AutomationAction,
  type AutomationActionType,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationConditionOp,
  type AutomationRule,
  type AutomationRulePayload,
  type AutomationTriggerType,
} from "@/services/project/project-automation.service";

const automationService = new ProjectAutomationService();

export type TCustomAutomationsRootProps = {
  projectId: string;
  workspaceSlug: string;
};

type ViewMode = { mode: "list" } | { mode: "edit"; rule: AutomationRule | null };

// ===========================================================================
// Pickable values (kept in sync with backend serializer validators).
// ===========================================================================

const TRIGGER_TYPES: { value: AutomationTriggerType; tKey: string }[] = [
  { value: "state_changed", tKey: "automation.trigger.state_changed" },
  { value: "assignee_added", tKey: "automation.trigger.assignee_added" },
  { value: "assignee_removed", tKey: "automation.trigger.assignee_removed" },
  { value: "priority_changed", tKey: "automation.trigger.priority_changed" },
  { value: "target_date_changed", tKey: "automation.trigger.target_date_changed" },
  { value: "labels_changed", tKey: "automation.trigger.labels_changed" },
  { value: "comment_added", tKey: "automation.trigger.comment_added" },
  { value: "due_soon", tKey: "automation.trigger.due_soon" },
];

const ACTION_TYPES: { value: AutomationActionType; tKey: string }[] = [
  { value: "set_state", tKey: "automation.action.set_state" },
  { value: "set_priority", tKey: "automation.action.set_priority" },
  { value: "add_assignee", tKey: "automation.action.add_assignee" },
  { value: "remove_assignee", tKey: "automation.action.remove_assignee" },
  { value: "add_label", tKey: "automation.action.add_label" },
  { value: "set_target_date", tKey: "automation.action.set_target_date" },
  { value: "notify_lark", tKey: "automation.action.notify_lark" },
];

const CONDITION_FIELDS: { value: AutomationConditionField; tKey: string }[] = [
  { value: "priority", tKey: "automation.field.priority" },
  { value: "state", tKey: "automation.field.state" },
  { value: "state_group", tKey: "automation.field.state_group" },
  { value: "assignee_ids", tKey: "automation.field.assignee_ids" },
  { value: "label_ids", tKey: "automation.field.label_ids" },
  { value: "target_date", tKey: "automation.field.target_date" },
  { value: "start_date", tKey: "automation.field.start_date" },
];

const CONDITION_OPS: { value: AutomationConditionOp; tKey: string }[] = [
  { value: "eq", tKey: "automation.op.eq" },
  { value: "ne", tKey: "automation.op.ne" },
  { value: "in", tKey: "automation.op.in" },
  { value: "not_in", tKey: "automation.op.not_in" },
  { value: "gt", tKey: "automation.op.gt" },
  { value: "lt", tKey: "automation.op.lt" },
  { value: "contains", tKey: "automation.op.contains" },
  { value: "is_null", tKey: "automation.op.is_null" },
  { value: "is_not_null", tKey: "automation.op.is_not_null" },
];

const PRIORITY_VALUES: { value: string; tKey: string }[] = [
  { value: "urgent", tKey: "automation.priority.urgent" },
  { value: "high", tKey: "automation.priority.high" },
  { value: "medium", tKey: "automation.priority.medium" },
  { value: "low", tKey: "automation.priority.low" },
  { value: "none", tKey: "automation.priority.none" },
];

const STATE_GROUPS: { value: string; tKey: string }[] = [
  { value: "backlog", tKey: "automation.state_group.backlog" },
  { value: "unstarted", tKey: "automation.state_group.unstarted" },
  { value: "started", tKey: "automation.state_group.started" },
  { value: "completed", tKey: "automation.state_group.completed" },
  { value: "cancelled", tKey: "automation.state_group.cancelled" },
];

// ===========================================================================
// Top-level root: switches between list and form views.
// ===========================================================================

export const CustomAutomationsRoot = observer(function CustomAutomationsRoot(props: TCustomAutomationsRootProps) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const [view, setView] = useState<ViewMode>({ mode: "list" });

  const { data: rules, isLoading } = useSWR(
    workspaceSlug && projectId ? `automation-rules:${workspaceSlug}:${projectId}` : null,
    () => automationService.list(workspaceSlug, projectId)
  );

  if (view.mode === "edit") {
    return (
      <RuleForm
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        rule={view.rule}
        onClose={() => setView({ mode: "list" })}
        onSaved={() => {
          mutate(`automation-rules:${workspaceSlug}:${projectId}`);
          setView({ mode: "list" });
        }}
      />
    );
  }

  return (
    <section className="border-custom-border-100 mt-10 border-t pt-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base flex items-center gap-2 font-semibold">
            <Zap className="text-custom-primary-100 h-4 w-4" />
            {t("automation.heading")}
          </h3>
          <p className="text-xs text-custom-text-300 mt-1">{t("automation.description")}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setView({ mode: "edit", rule: null })}>
          <Plus className="h-3.5 w-3.5" /> {t("automation.new_rule")}
        </Button>
      </div>

      {isLoading ? (
        <Loader>
          <Loader.Item height="48px" width="100%" />
          <Loader.Item height="48px" width="100%" />
        </Loader>
      ) : !rules || rules.length === 0 ? (
        <div className="border-custom-border-200 text-xs text-custom-text-300 rounded border border-dashed px-4 py-8 text-center">
          {t("automation.empty_state")}
        </div>
      ) : (
        <RulesList
          rules={rules}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onEdit={(rule) => setView({ mode: "edit", rule })}
        />
      )}
    </section>
  );
});

// ===========================================================================
// List view
// ===========================================================================

const RulesList = observer(function RulesList(props: {
  rules: AutomationRule[];
  workspaceSlug: string;
  projectId: string;
  onEdit: (rule: AutomationRule) => void;
}) {
  const { rules, workspaceSlug, projectId, onEdit } = props;
  const { t } = useTranslation();

  const handleToggle = async (rule: AutomationRule) => {
    try {
      await automationService.update(workspaceSlug, projectId, rule.id, { is_active: !rule.is_active });
      mutate(`automation-rules:${workspaceSlug}:${projectId}`);
    } catch (e) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("automation.toggle_failed"),
        message: String(e),
      });
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    if (!window.confirm(t("automation.confirm_delete", { name: rule.name }))) return;
    try {
      await automationService.destroy(workspaceSlug, projectId, rule.id);
      mutate(`automation-rules:${workspaceSlug}:${projectId}`);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("automation.deleted") });
    } catch (e) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("automation.delete_failed"), message: String(e) });
    }
  };

  return (
    <div className="border-custom-border-200 overflow-hidden rounded border">
      <table className="text-xs w-full">
        <thead className="bg-custom-background-90 text-custom-text-300">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t("automation.col_name")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("automation.col_trigger")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("automation.col_actions")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("automation.col_fire_count")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("automation.col_status")}</th>
            <th className="px-3 py-2 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-custom-border-100 border-t">
              <td className="px-3 py-2">
                <div className="font-medium">{rule.name}</div>
                {rule.description ? <div className="text-custom-text-300 text-[11px]">{rule.description}</div> : null}
              </td>
              <td className="px-3 py-2">{t(`automation.trigger.${rule.trigger_type}`)}</td>
              <td className="text-custom-text-300 px-3 py-2">
                {rule.actions.length}× {rule.actions.length > 0 ? t(`automation.action.${rule.actions[0].type}`) : "—"}
                {rule.actions.length > 1 ? ", ..." : ""}
              </td>
              <td className="text-custom-text-300 px-3 py-2">{rule.fire_count}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => handleToggle(rule)}
                  className="text-custom-text-200 hover:text-custom-text-100 inline-flex items-center gap-1"
                >
                  {rule.is_active ? (
                    <>
                      <ToggleRight className="text-emerald-500 h-4 w-4" />
                      {t("automation.active")}
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="text-custom-text-300 h-4 w-4" />
                      {t("automation.inactive")}
                    </>
                  )}
                </button>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(rule)}
                    className="text-custom-text-300 hover:bg-custom-background-90 hover:text-custom-text-100 rounded p-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(rule)}
                    className="text-custom-text-300 hover:bg-custom-background-90 hover:text-red-500 rounded p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ===========================================================================
// Create / Edit form
// ===========================================================================

interface RuleFormProps {
  workspaceSlug: string;
  projectId: string;
  rule: AutomationRule | null;
  onClose: () => void;
  onSaved: () => void;
}

const RuleForm = observer(function RuleForm(props: RuleFormProps) {
  const { workspaceSlug, projectId, rule, onClose, onSaved } = props;
  const { t } = useTranslation();

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(rule?.trigger_type ?? "state_changed");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(rule?.trigger_config ?? {});
  const [conditions, setConditions] = useState<AutomationCondition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? []);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("automation.error_name_required") });
      return;
    }
    if (actions.length === 0) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("automation.error_no_actions") });
      return;
    }
    const payload: AutomationRulePayload = {
      name: name.trim(),
      description: description.trim(),
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      conditions,
      actions,
      is_active: isActive,
    };
    setSaving(true);
    try {
      if (rule) {
        await automationService.update(workspaceSlug, projectId, rule.id, payload);
      } else {
        await automationService.create(workspaceSlug, projectId, payload);
      }
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("automation.saved") });
      onSaved();
    } catch (e: any) {
      const detail = e?.data ? JSON.stringify(e.data) : String(e);
      setToast({ type: TOAST_TYPE.ERROR, title: t("automation.save_failed"), message: detail });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-custom-border-100 mt-10 border-t pt-6">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-custom-text-300 hover:text-custom-text-100 flex items-center gap-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {t("automation.back_to_list")}
        </button>
        <div className="flex items-center gap-2">
          <label className="text-xs text-custom-text-300 flex items-center gap-1">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("automation.is_active")}
          </label>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t("automation.saving") : rule ? t("automation.save") : t("automation.create")}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs text-custom-text-200 block font-medium">{t("automation.field_name")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("automation.field_name_placeholder")}
            className="border-custom-border-200 bg-custom-background-100 text-sm w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-custom-text-200 block font-medium">{t("automation.field_description")}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("automation.field_description_placeholder")}
            className="border-custom-border-200 bg-custom-background-100 text-sm w-full rounded border px-3 py-2"
          />
        </div>

        <TriggerSection
          triggerType={triggerType}
          triggerConfig={triggerConfig}
          onTriggerChange={(v) => {
            setTriggerType(v);
            setTriggerConfig({});
          }}
          onConfigChange={setTriggerConfig}
        />

        <ConditionsSection projectId={projectId} conditions={conditions} onChange={setConditions} />

        <ActionsSection projectId={projectId} actions={actions} onChange={setActions} />
      </div>
    </section>
  );
});

// ===========================================================================
// Trigger section
// ===========================================================================

function TriggerSection(props: {
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  onTriggerChange: (v: AutomationTriggerType) => void;
  onConfigChange: (cfg: Record<string, unknown>) => void;
}) {
  const { triggerType, triggerConfig, onTriggerChange, onConfigChange } = props;
  const { t } = useTranslation();

  return (
    <div className="border-custom-primary-100/40 bg-custom-primary-100/5 rounded border-2 p-4">
      <div className="text-xs tracking-wider text-custom-primary-100 mb-2 flex items-center gap-2 font-medium uppercase">
        <Zap className="h-3 w-3" /> {t("automation.section_when")}
      </div>
      <select
        value={triggerType}
        onChange={(e) => onTriggerChange(e.target.value as AutomationTriggerType)}
        className="border-custom-border-200 bg-custom-background-100 text-sm w-full rounded border px-3 py-2"
      >
        {TRIGGER_TYPES.map((tr) => (
          <option key={tr.value} value={tr.value}>
            {t(tr.tKey)}
          </option>
        ))}
      </select>

      {triggerType === "due_soon" ? (
        <div className="text-xs mt-3 flex items-center gap-2">
          <span className="text-custom-text-300">{t("automation.due_soon_days_before")}</span>
          <input
            type="number"
            min={0}
            max={365}
            value={Number(triggerConfig.days_before ?? 7)}
            onChange={(e) => onConfigChange({ ...triggerConfig, days_before: Number(e.target.value) })}
            className="border-custom-border-200 bg-custom-background-100 text-sm w-20 rounded border px-2 py-1"
          />
          <span className="text-custom-text-300">{t("automation.days")}</span>
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
// Conditions section
// ===========================================================================

function ConditionsSection(props: {
  projectId: string;
  conditions: AutomationCondition[];
  onChange: (next: AutomationCondition[]) => void;
}) {
  const { projectId, conditions, onChange } = props;
  const { t } = useTranslation();

  const update = (idx: number, patch: Partial<AutomationCondition>) => {
    const next = conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };

  return (
    <div className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 rounded border-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs tracking-wider text-amber-700 dark:text-amber-400 font-medium uppercase">
          {t("automation.section_and_if")}
          <span className="font-normal text-custom-text-300 ml-2 normal-case">({t("automation.conditions_hint")})</span>
        </div>
        <button
          type="button"
          onClick={() => onChange([...conditions, { field: "priority", op: "eq", value: "high" }])}
          className="border-custom-border-200 bg-custom-background-100 text-xs hover:bg-custom-background-90 flex items-center gap-1 rounded border px-2 py-1"
        >
          <Plus className="h-3 w-3" /> {t("automation.add_condition")}
        </button>
      </div>

      {conditions.length === 0 ? (
        <div className="text-xs text-custom-text-300">{t("automation.no_conditions")}</div>
      ) : (
        <div className="space-y-2">
          {conditions.map((cond, idx) => (
            <ConditionRow
              // eslint-disable-next-line react/no-array-index-key -- local-state list, items have no stable id; reorder is not supported in the UI
              key={idx}
              projectId={projectId}
              condition={cond}
              onUpdate={(patch) => update(idx, patch)}
              onRemove={() => onChange(conditions.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionRow(props: {
  projectId: string;
  condition: AutomationCondition;
  onUpdate: (patch: Partial<AutomationCondition>) => void;
  onRemove: () => void;
}) {
  const { projectId, condition, onUpdate, onRemove } = props;
  const { t } = useTranslation();
  const stateRoot = useProjectState();
  const projectStates = stateRoot.getProjectStates(projectId) ?? [];

  return (
    <div className="bg-custom-background-100 flex flex-wrap items-center gap-2 rounded px-2 py-1.5">
      <select
        value={condition.field}
        onChange={(e) => onUpdate({ field: e.target.value as AutomationConditionField, value: "" })}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {t(f.tKey)}
          </option>
        ))}
      </select>
      <select
        value={condition.op}
        onChange={(e) => onUpdate({ op: e.target.value as AutomationConditionOp })}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        {CONDITION_OPS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.tKey)}
          </option>
        ))}
      </select>
      {condition.op === "is_null" || condition.op === "is_not_null" ? null : (
        <ConditionValueInput
          field={condition.field}
          value={condition.value}
          onChange={(v) => onUpdate({ value: v })}
          projectStates={projectStates}
        />
      )}
      <button type="button" onClick={onRemove} className="text-custom-text-300 hover:text-red-500 ml-auto rounded p-1">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ConditionValueInput(props: {
  field: AutomationConditionField;
  value: unknown;
  onChange: (v: unknown) => void;
  projectStates: Array<{ id: string; name: string }>;
}) {
  const { field, value, onChange, projectStates } = props;
  const { t } = useTranslation();

  if (field === "priority") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        <option value="">--</option>
        {PRIORITY_VALUES.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.tKey)}
          </option>
        ))}
      </select>
    );
  }
  if (field === "state") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        <option value="">--</option>
        {projectStates.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    );
  }
  if (field === "state_group") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        <option value="">--</option>
        {STATE_GROUPS.map((g) => (
          <option key={g.value} value={g.value}>
            {t(g.tKey)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("automation.value_placeholder")}
      className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
    />
  );
}

// ===========================================================================
// Actions section
// ===========================================================================

function ActionsSection(props: {
  projectId: string;
  actions: AutomationAction[];
  onChange: (next: AutomationAction[]) => void;
}) {
  const { projectId, actions, onChange } = props;
  const { t } = useTranslation();

  const update = (idx: number, patch: Partial<AutomationAction>) => {
    const next = actions.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    onChange(next);
  };

  return (
    <div className="border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/10 rounded border-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs tracking-wider text-emerald-700 dark:text-emerald-400 font-medium uppercase">
          {t("automation.section_then")}
        </div>
        <button
          type="button"
          onClick={() => onChange([...actions, { type: "set_state", config: {} }])}
          className="border-custom-border-200 bg-custom-background-100 text-xs hover:bg-custom-background-90 flex items-center gap-1 rounded border px-2 py-1"
        >
          <Plus className="h-3 w-3" /> {t("automation.add_action")}
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="text-xs text-custom-text-300">{t("automation.no_actions")}</div>
      ) : (
        <div className="space-y-2">
          {actions.map((a, idx) => (
            <ActionRow
              // eslint-disable-next-line react/no-array-index-key -- local-state list, items have no stable id; reorder is not supported in the UI
              key={idx}
              projectId={projectId}
              action={a}
              onUpdate={(patch) => update(idx, patch)}
              onRemove={() => onChange(actions.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRow(props: {
  projectId: string;
  action: AutomationAction;
  onUpdate: (patch: Partial<AutomationAction>) => void;
  onRemove: () => void;
}) {
  const { projectId, action, onUpdate, onRemove } = props;
  const { t } = useTranslation();
  const stateRoot = useProjectState();
  const memberRoot = useMember();
  const projectStates = stateRoot.getProjectStates(projectId) ?? [];
  const projectMemberIds = memberRoot.project?.getProjectMemberIds?.(projectId, false) ?? [];

  return (
    <div className="bg-custom-background-100 rounded p-2">
      <div className="flex items-center gap-2">
        <select
          value={action.type}
          onChange={(e) => onUpdate({ type: e.target.value as AutomationActionType, config: {} })}
          className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
        >
          {ACTION_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {t(a.tKey)}
            </option>
          ))}
        </select>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <ActionConfigInput
            action={action}
            onChange={(cfg) => onUpdate({ config: cfg })}
            projectStates={projectStates}
            projectMemberIds={projectMemberIds}
            memberRoot={memberRoot}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-custom-text-300 hover:text-red-500 ml-auto rounded p-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ActionConfigInput(props: {
  action: AutomationAction;
  onChange: (cfg: Record<string, unknown>) => void;
  projectStates: Array<{ id: string; name: string }>;
  projectMemberIds: string[];
  memberRoot: ReturnType<typeof useMember>;
}) {
  const { action, onChange, projectStates, projectMemberIds, memberRoot } = props;
  const { t } = useTranslation();
  const cfg = action.config ?? {};

  if (action.type === "set_state") {
    return (
      <>
        <span className="text-xs text-custom-text-300">{t("automation.action.to")}:</span>
        <select
          value={String((cfg as Record<string, string>).state_id ?? "")}
          onChange={(e) => onChange({ state_id: e.target.value })}
          className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
        >
          <option value="">{t("automation.choose_state")}</option>
          {projectStates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-custom-text-300">{t("automation.or_group")}:</span>
        <select
          value={String((cfg as Record<string, string>).state_group ?? "")}
          onChange={(e) => onChange(e.target.value ? { state_group: e.target.value } : {})}
          className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
        >
          <option value="">--</option>
          {STATE_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {t(g.tKey)}
            </option>
          ))}
        </select>
      </>
    );
  }
  if (action.type === "set_priority") {
    return (
      <select
        value={String((cfg as Record<string, string>).priority ?? "")}
        onChange={(e) => onChange({ priority: e.target.value })}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        <option value="">--</option>
        {PRIORITY_VALUES.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.tKey)}
          </option>
        ))}
      </select>
    );
  }
  if (action.type === "add_assignee" || action.type === "remove_assignee") {
    return (
      <select
        value={String((cfg as Record<string, string>).user_id ?? "")}
        onChange={(e) => onChange({ user_id: e.target.value })}
        className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
      >
        <option value="">{t("automation.choose_user")}</option>
        {projectMemberIds.map((uid) => {
          const u = memberRoot.getUserDetails?.(uid);
          return (
            <option key={uid} value={uid}>
              {u?.display_name ?? uid}
            </option>
          );
        })}
      </select>
    );
  }
  if (action.type === "set_target_date") {
    return (
      <>
        <input
          type="date"
          value={String((cfg as Record<string, string>).target_date ?? "")}
          onChange={(e) => onChange({ target_date: e.target.value })}
          className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
        />
        <span className="text-xs text-custom-text-300">{t("automation.or_days_from_now")}:</span>
        <input
          type="number"
          value={String((cfg as Record<string, number>).days_from_now ?? "")}
          onChange={(e) => onChange(e.target.value ? { days_from_now: Number(e.target.value) } : {})}
          placeholder="7"
          className="border-custom-border-200 bg-custom-background-100 text-xs w-16 rounded border px-2 py-1"
        />
      </>
    );
  }
  if (action.type === "notify_lark") {
    return (
      <>
        <span className="text-xs text-custom-text-300">{t("automation.notify_to")}:</span>
        <select
          value={String((cfg as Record<string, string>).to ?? "assignees")}
          onChange={(e) => onChange({ ...cfg, to: e.target.value })}
          className="border-custom-border-200 bg-custom-background-100 text-xs rounded border px-2 py-1"
        >
          <option value="assignees">{t("automation.notify_assignees")}</option>
          <option value="creator">{t("automation.notify_creator")}</option>
        </select>
      </>
    );
  }
  return (
    <input
      type="text"
      value={JSON.stringify(cfg)}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value || "{}"));
        } catch {
          /* tolerate intermediate invalid JSON */
        }
      }}
      placeholder='{"key": "value"}'
      className="border-custom-border-200 bg-custom-background-100 font-mono flex-1 rounded border px-2 py-1 text-[11px]"
    />
  );
}
