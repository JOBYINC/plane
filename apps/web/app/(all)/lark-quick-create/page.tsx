/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Lark quick-create shortcut handler.
 *
 * Reachable via AppLink:
 *   https://applink.feishu.cn/client/web_url/open?mode=sidebar-semi&url=
 *   https%3A%2F%2Ftask.vijimgroup.com%2Flark-quick-create%2F%3Fentry%3D{plus_menu|message_shortcut}
 *
 * Flow:
 *  1. Wait for window.h5sdk (loaded via <script> tag)
 *  2. POST current page URL to /auth/lark/jssdk-signature -> {appId, timestamp, nonceStr, signature}
 *  3. h5sdk.config(...) with the signature + jsApiList we need
 *  4. Branch on ?entry= query param:
 *      - message_shortcut: tt.getBlockActionSourceDetail(triggerCode) -> pre-fill from message body
 *      - plus_menu:        tt.getTriggerContext() -> just open the form
 *  5. User picks project + edits title -> POST to issue-create -> tt.closeWindow()
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Button } from "@plane/propel/button";
import { Loader } from "@plane/ui";
import { useTranslation } from "@plane/i18n";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { useMember } from "@/hooks/store/use-member";
import { IssueService } from "@/services/issue/issue.service";
import { WorkspaceService } from "@/services/workspace.service";
import { ProjectMemberService } from "@/services/project/project-member.service";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import type { TIssuePriorities } from "@plane/types";

// CN region CDN — more reliable for feishu.cn clients than the bytegoofy
// fallback. If load fails we retry on bytegoofy.com.
const H5_SDK_URLS = [
  "https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.34.js",
  "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.23.js",
];
// errno 104 was caused by getTriggerContext (gadget-only). With that
// removed the remaining web_app-compatible methods are safe to request.
const JS_API_LIST = ["getBlockActionSourceDetail", "closeWindow"];
const TITLE_MAX = 80;

declare global {
  interface Window {
    h5sdk?: {
      ready: (cb: () => void) => void;
      error: (cb: (err: unknown) => void) => void;
      config: (cfg: {
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
        jsApiList: string[];
        onSuccess?: () => void;
        onFail?: (err: unknown) => void;
      }) => void;
    };
    tt?: {
      getBlockActionSourceDetail: (args: {
        triggerCode: string;
        success: (res: unknown) => void;
        fail: (err: unknown) => void;
      }) => void;
      closeWindow: () => void;
    };
  }
}

type LarkSourceDetail = {
  message_id?: string;
  chat_id?: string;
  sender?: { open_id?: string; user_id?: string; union_id?: string };
  content?: { text?: string; title?: string };
};

const issueService = new IssueService();
const _workspaceService = new WorkspaceService();
const projectMemberService = new ProjectMemberService();

type MemberOption = { id: string; name: string; avatar: string };

async function fetchSignature(url: string): Promise<{
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}> {
  const resp = await fetch("/auth/lark/jssdk-signature/", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) throw new Error(`signature mint failed: ${resp.status}`);
  return resp.json();
}

function waitForH5sdk(timeoutMs = 4000): Promise<void> {
  if (window.h5sdk) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const id = window.setInterval(() => {
      if (window.h5sdk) {
        window.clearInterval(id);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        window.clearInterval(id);
        reject(new Error(`h5sdk did not appear within ${timeoutMs}ms`));
      }
    }, 80);
  });
}

async function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.dataset.larkH5sdk = url;
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error(`script load failed: ${url}`)));
    document.head.appendChild(s);
  });
}

async function loadSdkOnce(): Promise<void> {
  if (window.h5sdk) return;
  // If a prior call started an inject we'll see the marker script - just wait.
  if (document.querySelector(`script[data-lark-h5sdk]`)) {
    await waitForH5sdk();
    return;
  }
  let lastErr: unknown = null;
  for (const url of H5_SDK_URLS) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential SDK fallback: try CDN URLs one at a time, succeed-and-return on first
      await injectScript(url);
      // eslint-disable-next-line no-await-in-loop -- same fallback loop; SDK readiness check must follow its own inject
      await waitForH5sdk();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all sdk CDNs failed");
}

function deriveTitle(text: string | undefined): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Local-date YYYY-MM-DD offset by `days` from today. Used for the Lark-style
// quick-pick buttons (今天/明天/后天/一周后).
function ymd(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return ymdFromDate(d);
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LarkQuickCreatePage = observer(() => {
  const { t } = useTranslation();
  const workspaceRoot = useWorkspace();
  const projectStore = useProject();
  const { data: currentUser } = useUser();
  // Member store -- MemberDropdown resolves names/avatars via this map.
  const memberRoot = useMember();
  const { workspaces } = workspaceRoot;
  const { joinedProjectIds: _joinedProjectIds, getProjectById: _getProjectById } = projectStore;

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [diagInfo, setDiagInfo] = useState<Record<string, unknown>>({});
  const [_source, setSource] = useState<LarkSourceDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Local project list -- bypasses the store's joinedProjectIds getter which
  // requires currentWorkspace + project.member_role, both unset on this
  // standalone page. We trust whatever the project-list API returned.
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  // Mirror Lark native task panel: priority + due date + assignee.
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low" | "none">("none");
  const [targetDate, setTargetDate] = useState<string>(""); // YYYY-MM-DD or empty
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [_assigneeQuery, _setAssigneeQuery] = useState<string>("");
  const [_assigneeOpen, _setAssigneeOpen] = useState<boolean>(false);
  // Project-member check: warn when the chosen assignee isn't a member of
  // the chosen project (they'd be assigned an issue they can't see).
  const [projectMemberIds, setProjectMemberIds] = useState<Set<string>>(new Set());

  // Default to the user's first joined workspace. The shortcut doesn't carry
  // workspace context; multi-workspace switching can come later.
  const workspaceList = Object.values(workspaces ?? {});
  const workspace = workspaceList[0];

  useSWR(
    ready ? null : "lark-quick-create-boot",
    async () => {
      try {
        await loadSdkOnce();
        const pageUrl = window.location.href.split("#")[0];
        setDiagInfo((d) => ({
          ...d,
          windowLocation: window.location.href,
          pageUrlSent: pageUrl,
          userAgent: navigator.userAgent,
        }));
        const cfg = await fetchSignature(pageUrl);
        setDiagInfo((d) => ({
          ...d,
          appId: cfg.appId,
          timestamp: cfg.timestamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
          jsApiList: JS_API_LIST,
        }));

        const configPayload = {
          ...cfg,
          jsApiList: JS_API_LIST,
        };
        // eslint-disable-next-line no-console
        console.log("[lark-quick-create] signing URL:", pageUrl);
        // eslint-disable-next-line no-console
        console.log("[lark-quick-create] h5sdk.config payload:", configPayload);
        // eslint-disable-next-line no-console
        console.log("[lark-quick-create] navigator.userAgent:", navigator.userAgent);

        await new Promise<void>((resolve, reject) => {
          if (!window.h5sdk) return reject(new Error("h5sdk missing"));
          window.h5sdk.error((err) => {
            // eslint-disable-next-line no-console
            console.error("[lark-quick-create] h5sdk.error fired:", err);
            reject(err);
          });
          window.h5sdk.config({
            ...configPayload,
            onSuccess: () => resolve(),
            onFail: (err) => {
              // eslint-disable-next-line no-console
              console.error("[lark-quick-create] h5sdk.config onFail:", err);
              reject(err);
            },
          });
        });

        await new Promise<void>((resolve) => {
          if (!window.h5sdk) return resolve();
          window.h5sdk.ready(() => resolve());
        });

        // Per the Feishu message-shortcut doc:
        //   - PC adds `from=message_action`, mobile adds `required_launch_ability=message_action`
        //   - `bdp_launch_query` is a JSON-encoded string containing `__trigger_id__`
        // Read those (and fall back to our explicit ?entry= hint) to decide
        // whether to fetch the message source body.
        const qp = new URLSearchParams(window.location.search);
        const isMessageShortcut =
          qp.get("from") === "message_action" ||
          qp.get("required_launch_ability") === "message_action" ||
          qp.get("entry") === "message_shortcut";

        if (isMessageShortcut && window.tt?.getBlockActionSourceDetail) {
          const rawLaunchQuery = qp.get("bdp_launch_query") ?? "";
          let triggerCode = "";
          if (rawLaunchQuery) {
            try {
              const parsed = JSON.parse(rawLaunchQuery);
              triggerCode = parsed?.__trigger_id__ ?? "";
            } catch {
              // Some Lark versions may already deliver an unwrapped trigger_id;
              // tolerate by using the raw value as a last resort.
              triggerCode = rawLaunchQuery;
            }
          }
          // eslint-disable-next-line no-console
          console.log("[lark-quick-create] message shortcut triggerCode:", triggerCode);

          if (triggerCode) {
            await new Promise<void>((resolve) => {
              window.tt!.getBlockActionSourceDetail({
                triggerCode,
                success: (res: unknown) => {
                  // eslint-disable-next-line no-console
                  console.log("[lark-quick-create] source detail raw:", res);
                  setDiagInfo((d) => ({ ...d, sourceRaw: res }));

                  // Real shape (Lark 7.67):
                  //   {errMsg, bizType: "message", content: {actionTime,
                  //     messages: [{support, content: '{"text":"..."}',
                  //                  sender: {name, open_id}, ...}]}}
                  const r = res as
                    | {
                        content?: {
                          messages?: Array<{
                            support?: boolean;
                            content?: string;
                            messageType?: string;
                            sender?: { name?: string; open_id?: string };
                          }>;
                        };
                      }
                    | undefined;
                  const msg = r?.content?.messages?.[0];
                  if (msg?.support && msg.content) {
                    let text = "";
                    try {
                      const parsed = JSON.parse(msg.content);
                      text = (parsed?.text as string | undefined) ?? (parsed?.title as string | undefined) ?? "";
                    } catch {
                      text = msg.content;
                    }
                    setSource({
                      sender: msg.sender,
                      content: { text },
                    });
                    setTitle(deriveTitle(text));
                    setDescription(text);
                  }
                  resolve();
                },
                fail: (err: unknown) => {
                  // eslint-disable-next-line no-console
                  console.error("[lark-quick-create] getBlockActionSourceDetail fail:", err);
                  setDiagInfo((d) => ({ ...d, sourceDetailError: err }));
                  resolve();
                },
              });
            });
          }
        }

        // Page lives outside the workspace-slug layout, so the workspace +
        // project MobX stores aren't auto-hydrated. Fetch them here.
        let ws: Array<{ slug?: string }> | undefined;
        let fetchedProjects: unknown = null;
        let fetchError: string | null = null;
        try {
          ws = await workspaceRoot.fetchWorkspaces();
        } catch (e) {
          fetchError = `fetchWorkspaces: ${e instanceof Error ? e.message : String(e)}`;
        }
        const primaryWorkspace = ws?.[0];
        if (primaryWorkspace?.slug) {
          try {
            fetchedProjects = await projectStore.fetchProjects(primaryWorkspace.slug);
          } catch (e) {
            fetchError = `fetchProjects: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        // Hydrate local options regardless of the store's joined-filter.
        if (Array.isArray(fetchedProjects)) {
          const arr = (fetchedProjects as Array<Record<string, unknown>>)
            .filter((p) => !p?.archived_at)
            .map((p) => ({ id: String(p?.id ?? ""), name: String(p?.name ?? "") }))
            .filter((p) => p.id && p.name);
          setProjectOptions(arr);
        }

        // Workspace members -- use the store action (NOT the raw service)
        // so memberRoot.memberMap gets hydrated. MemberDropdown reads names
        // and avatars from that map via getUserDetails(id); without it we
        // see "no match" for every member.
        if (primaryWorkspace?.slug) {
          try {
            const rawMembers = await memberRoot.workspace.fetchWorkspaceMembers(primaryWorkspace.slug);
            // fetchWorkspaceMembers returns IWorkspaceMember[], but the shape used here
            // is duck-typed (member-object vs flat — depends on API shape evolution).
            // Keep the defensive Record<string, unknown> handling and cast at the boundary.
            const mapped: MemberOption[] = ((rawMembers ?? []) as unknown as Array<Record<string, unknown>>)
              .map((m) => {
                const memberObj = (m?.member as Record<string, unknown> | undefined) ?? null;
                const id = String(memberObj?.id ?? m?.member_id ?? m?.id ?? "");
                const name = String(
                  memberObj?.display_name ?? memberObj?.first_name ?? memberObj?.email ?? m?.display_name ?? id ?? ""
                );
                const avatar = String(memberObj?.avatar_url ?? memberObj?.avatar ?? m?.avatar_url ?? "");
                return { id, name, avatar };
              })
              .filter((x: MemberOption) => x.id && x.name);
            setMemberOptions(mapped);
          } catch {
            /* silent - assignee falls back to current user */
          }
        }
        setDiagInfo((d) => ({
          ...d,
          workspacesReturned: Array.isArray(ws) ? ws.length : "undefined",
          primaryWorkspaceSlug: primaryWorkspace?.slug ?? null,
          fetchProjectsReturned: Array.isArray(fetchedProjects) ? fetchedProjects.length : "non-array",
          joinedProjectIdsAfterFetch: projectStore.joinedProjectIds.length,
          fetchError,
        }));

        setReady(true);
      } catch (err) {
        let msg: string;
        if (err instanceof Error) {
          msg = err.message;
        } else if (typeof err === "string") {
          msg = err;
        } else {
          try {
            msg = JSON.stringify(err);
          } catch {
            msg = String(err);
          }
        }
        // eslint-disable-next-line no-console
        console.error("[lark-quick-create] boot failed:", err);
        setBootError(msg);
      }
    },
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!projectId && projectOptions.length > 0) {
      // Default project selection priority:
      //   1. Anything containing "team inbox" (the shared workspace landing)
      //   2. Anything containing "inbox" / "收纳" / "未分类" (single-user inbox)
      //   3. First project in the list (fallback)
      // Matching anywhere in the name -- not just prefix -- so "Team Inbox"
      // wins over a personal "INBOX" if both exist.
      const teamInbox = projectOptions.find((p) => /team[\s_-]*inbox|团队[\s_-]*(inbox|收纳|收件)/i.test(p.name));
      const anyInbox = projectOptions.find((p) => /(inbox|收纳|未分类)/i.test(p.name));
      setProjectId((teamInbox ?? anyInbox ?? projectOptions[0]).id);
    }
  }, [projectOptions, projectId]);

  // Default assignee to current user once both are known.
  useEffect(() => {
    if (!assigneeId && currentUser?.id) setAssigneeId(String(currentUser.id));
  }, [currentUser, assigneeId]);

  // Fetch the chosen project's members whenever the project changes, so we
  // can warn when the assignee isn't a member (they'd be assigned a task
  // they can't see in any project / kanban view).
  useEffect(() => {
    if (!workspace?.slug || !projectId) {
      setProjectMemberIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await projectMemberService.fetchProjectMembers(workspace.slug, projectId);
        if (cancelled) return;
        const ids = new Set<string>();
        (rows ?? []).forEach((row: Record<string, unknown>) => {
          const memberObj = (row?.member as Record<string, unknown> | undefined) ?? null;
          const id = String(memberObj?.id ?? row?.member_id ?? "");
          if (id) ids.add(id);
        });
        setProjectMemberIds(ids);
      } catch {
        if (!cancelled) setProjectMemberIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace?.slug, projectId]);

  const assigneeIsMember = !assigneeId || projectMemberIds.size === 0 || projectMemberIds.has(assigneeId);

  // Search pool for the assignee dropdown = the workspace members we already
  // fetched into local state above. Going through `memberRoot.workspace.
  // getWorkspaceMemberIds(slug)` would also work in theory, but its sort step
  // reads from routerStore + userStore which aren't fully hydrated on this
  // standalone page, so the computed sometimes returns []. The fetch above
  // already populates memberRoot.memberMap, so MemberDropdown's
  // getUserDetails(id) lookup still resolves names + avatars.
  const workspaceMemberIds: string[] = memberOptions.map((m) => m.id);

  const handleSubmit = async () => {
    if (!workspace || !projectId || !currentUser) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("lark_quick_create.error_no_project") });
      return;
    }
    if (!title.trim()) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("lark_quick_create.error_no_title") });
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: title.trim(),
        description_html: description ? `<p>${escapeHtml(description)}</p>` : "<p></p>",
        assignee_ids: [assigneeId || String(currentUser.id)],
        priority,
      };
      if (targetDate) payload.target_date = targetDate;
      await issueService.createIssue(workspace.slug, projectId, payload);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("lark_quick_create.success_created") });
      window.tt?.closeWindow?.();
    } catch (err) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("lark_quick_create.error_create_failed"), message: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (bootError) {
    return (
      <div className="text-xs p-4">
        <div className="text-red-600 mb-2 font-semibold">
          {t("lark_quick_create.sdk_init_failed")}: {bootError}
        </div>
        <details open className="border-custom-border-200 mt-3 rounded border p-2">
          <summary className="cursor-pointer font-medium">诊断信息 (截图发我)</summary>
          <pre className="mt-2 overflow-auto text-[10px] leading-tight break-all whitespace-pre-wrap">
            {JSON.stringify(diagInfo, null, 2)}
          </pre>
        </details>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="p-4">
        <Loader>
          <Loader.Item height="32px" width="60%" />
          <Loader.Item height="120px" width="100%" />
        </Loader>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 pb-24">
        <h1 className="text-sm mb-3 font-semibold">{t("lark_quick_create.new_task_title")}</h1>

        <label className="text-xs flex flex-col gap-1">
          <span className="text-custom-text-300">{t("lark_quick_create.field_project")}</span>
          <select
            className="border-custom-border-200 bg-custom-background-100 text-sm rounded border px-2 py-1.5"
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projectOptions.length === 0 ? (
              <option value="">{t("lark_quick_create.no_projects")}</option>
            ) : (
              projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="text-xs flex flex-col gap-1">
          <span className="text-custom-text-300">{t("lark_quick_create.field_title")}</span>
          <input
            type="text"
            maxLength={TITLE_MAX}
            className="border-custom-border-200 bg-custom-background-100 text-sm rounded border px-2 py-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("lark_quick_create.placeholder_title")}
          />
        </label>

        <label className="text-xs flex flex-col gap-1">
          <span className="text-custom-text-300">{t("lark_quick_create.field_description")}</span>
          <textarea
            rows={4}
            className="border-custom-border-200 bg-custom-background-100 text-sm rounded border px-2 py-1.5"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("lark_quick_create.placeholder_description")}
          />
        </label>

        {/* Due date — label on left, quick buttons + calendar picker on right */}
        <div className="text-xs flex items-start gap-3">
          <span className="text-custom-text-300 w-16 shrink-0 pt-1">{t("lark_quick_create.field_due_date")}</span>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {[
              { label: t("lark_quick_create.due_today"), value: ymd(0) },
              { label: t("lark_quick_create.due_tomorrow"), value: ymd(1) },
              { label: t("lark_quick_create.due_day_after"), value: ymd(2) },
              { label: t("lark_quick_create.due_one_week"), value: ymd(7) },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setTargetDate(opt.value === targetDate ? "" : opt.value)}
                className={`text-xs rounded border-2 bg-white px-2 py-1 ${
                  targetDate === opt.value
                    ? "border-custom-primary-100 text-custom-primary-100"
                    : "border-custom-border-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <DateDropdown
              value={targetDate ? new Date(targetDate) : null}
              onChange={(d) => setTargetDate(d ? ymdFromDate(d) : "")}
              buttonVariant="border-with-text"
              placeholder={t("lark_quick_create.field_due_date")}
              buttonClassName="border-2 bg-white"
            />
            {targetDate ? (
              <button
                type="button"
                onClick={() => setTargetDate("")}
                className="text-xs text-custom-text-400 underline"
              >
                {t("lark_quick_create.clear")}
              </button>
            ) : null}
          </div>
        </div>

        {/* Label-on-left, control-on-right rows. Labels share a fixed width
          so the controls line up visually. */}
        <div className="text-xs flex items-center gap-3">
          <span className="text-custom-text-300 w-16 shrink-0">{t("lark_quick_create.field_priority")}</span>
          <PriorityDropdown
            value={priority as TIssuePriorities}
            onChange={(p) => setPriority(p as typeof priority)}
            buttonVariant="border-with-text"
            buttonClassName="border-2 bg-white"
          />
        </div>

        <div className="text-xs flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="text-custom-text-300 w-16 shrink-0">{t("lark_quick_create.field_assignee")}</span>
            {projectId ? (
              <MemberDropdown
                memberIds={workspaceMemberIds}
                value={assigneeId || null}
                onChange={(id: string | null) => setAssigneeId(id ?? "")}
                buttonVariant="border-with-text"
                placeholder={t("lark_quick_create.field_assignee")}
                multiple={false}
                buttonClassName="border-2 bg-white"
              />
            ) : null}
          </div>
          {!assigneeIsMember ? (
            <span className="text-amber-600 pl-[4.75rem] text-[11px]">
              {t("lark_quick_create.warning_assignee_not_member")}
            </span>
          ) : null}
        </div>
      </div>

      {/* Sticky footer so Create/Cancel stay visible even when content overflows. */}
      <div className="border-custom-border-200 bg-custom-background-100 sticky bottom-0 flex gap-2 border-t p-3">
        <Button variant="primary" onClick={handleSubmit} disabled={submitting || !title.trim() || !projectId}>
          {submitting ? t("lark_quick_create.creating") : t("lark_quick_create.create_task")}
        </Button>
        <Button variant="secondary" onClick={() => window.tt?.closeWindow?.()}>
          {t("lark_quick_create.cancel")}
        </Button>
      </div>
    </div>
  );
});

export default LarkQuickCreatePage;
