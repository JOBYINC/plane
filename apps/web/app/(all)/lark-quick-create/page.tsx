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
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { IssueService } from "@/services/issue/issue.service";
import { WorkspaceService } from "@/services/workspace.service";

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
const workspaceService = new WorkspaceService();

type MemberOption = { id: string; name: string };

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
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`script load failed: ${url}`));
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
      await injectScript(url);
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Local-date YYYY-MM-DD offset by `days` from today. Used for the Lark-style
// quick-pick buttons (今天/明天/后天/一周后).
function ymd(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LarkQuickCreatePage = observer(() => {
  const workspaceRoot = useWorkspace();
  const projectStore = useProject();
  const { data: currentUser } = useUser();
  const { workspaces } = workspaceRoot;
  const { joinedProjectIds, getProjectById } = projectStore;

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [diagInfo, setDiagInfo] = useState<Record<string, unknown>>({});
  const [source, setSource] = useState<LarkSourceDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Local project list -- bypasses the store's joinedProjectIds getter which
  // requires currentWorkspace + project.member_role, both unset on this
  // standalone page. We trust whatever the project-list API returned.
  const [projectOptions, setProjectOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  // Mirror Lark native task panel: priority + due date + assignee.
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low" | "none">(
    "none",
  );
  const [targetDate, setTargetDate] = useState<string>(""); // YYYY-MM-DD or empty
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [assigneeQuery, setAssigneeQuery] = useState<string>("");
  const [assigneeOpen, setAssigneeOpen] = useState<boolean>(false);

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
                  // Per the doc: response shape is {support: bool, content: str|json}
                  // When support=true and message is text, content is a JSON
                  // string we need to parse to get the message body. When
                  // support=false, content is a plain string explanation.
                  const r = res as { support?: boolean; content?: unknown } | undefined;
                  setDiagInfo((d) => ({
                    ...d,
                    sourceRaw: res,
                  }));
                  if (r?.support && r.content) {
                    let parsedContent: Record<string, unknown> | null = null;
                    if (typeof r.content === "string") {
                      try {
                        parsedContent = JSON.parse(r.content);
                      } catch {
                        parsedContent = { text: r.content };
                      }
                    } else if (typeof r.content === "object") {
                      parsedContent = r.content as Record<string, unknown>;
                    }
                    const text =
                      (parsedContent?.text as string | undefined) ??
                      (parsedContent?.content as string | undefined) ??
                      "";
                    setSource({ content: { text } });
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

        // Workspace members for the assignee picker.
        if (primaryWorkspace?.slug) {
          try {
            const rawMembers = await workspaceService.fetchWorkspaceMembers(
              primaryWorkspace.slug,
            );
            const mapped: MemberOption[] = (rawMembers ?? [])
              .map((m: Record<string, unknown>) => {
                const memberObj =
                  (m?.member as Record<string, unknown> | undefined) ?? null;
                const id = String(memberObj?.id ?? m?.member_id ?? m?.id ?? "");
                const name = String(
                  memberObj?.display_name ??
                    memberObj?.first_name ??
                    memberObj?.email ??
                    m?.display_name ??
                    id ??
                    "",
                );
                return { id, name };
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
          fetchProjectsReturned: Array.isArray(fetchedProjects)
            ? fetchedProjects.length
            : "non-array",
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
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!projectId && projectOptions.length > 0) {
      // Prefer an "INBOX" project if present, otherwise the first one.
      const inbox = projectOptions.find((p) => /^(inbox|收纳|未分类)/i.test(p.name));
      setProjectId((inbox ?? projectOptions[0]).id);
    }
  }, [projectOptions, projectId]);

  // Default assignee to current user once both are known.
  useEffect(() => {
    if (!assigneeId && currentUser?.id) setAssigneeId(String(currentUser.id));
  }, [currentUser, assigneeId]);

  const handleSubmit = async () => {
    if (!workspace || !projectId || !currentUser) {
      setToast({ type: TOAST_TYPE.ERROR, title: "缺少工作区或项目" });
      return;
    }
    if (!title.trim()) {
      setToast({ type: TOAST_TYPE.ERROR, title: "任务标题不能为空" });
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
      setToast({ type: TOAST_TYPE.SUCCESS, title: "已创建 Tick 任务" });
      window.tt?.closeWindow?.();
    } catch (err) {
      setToast({ type: TOAST_TYPE.ERROR, title: "创建失败", message: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (bootError) {
    return (
      <div className="p-4 text-xs">
        <div className="mb-2 font-semibold text-red-600">
          Lark SDK 初始化失败：{bootError}
        </div>
        <details open className="mt-3 rounded border border-custom-border-200 p-2">
          <summary className="cursor-pointer font-medium">诊断信息 (截图发我)</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-tight">
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
      <div className="flex-1 overflow-y-auto p-4 pb-24">
      <h1 className="mb-3 text-base font-semibold">新建 Tick 任务</h1>

      <details className="mb-3 rounded border border-custom-border-200 p-2 text-[10px]">
        <summary className="cursor-pointer text-custom-text-400">🔧 调试 (开发用)</summary>
        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all leading-tight">
          {JSON.stringify(
            {
              projectOptionsLength: projectOptions.length,
              projectOptionsSample: projectOptions.slice(0, 3),
              currentProjectId: projectId,
              sourcePrefill: source ? { hasContent: !!source.content?.text } : null,
              joinedProjectIdsLength: joinedProjectIds.length,
              ...diagInfo,
            },
            null,
            2,
          )}
        </pre>
      </details>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">项目</span>
        <select
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projectOptions.length === 0 ? (
            <option value="">无可用项目</option>
          ) : (
            projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">标题</span>
        <input
          type="text"
          maxLength={TITLE_MAX}
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="任务标题"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">描述</span>
        <textarea
          rows={4}
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="任务详情（可选）"
        />
      </label>

      {/* Due date with quick buttons (Lark-native style) */}
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">截止日期</span>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: "今天", value: ymd(0) },
            { label: "明天", value: ymd(1) },
            { label: "后天", value: ymd(2) },
            { label: "一周后", value: ymd(7) },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setTargetDate(opt.value === targetDate ? "" : opt.value)}
              className={`rounded border px-2 py-1 text-xs ${
                targetDate === opt.value
                  ? "border-custom-primary-100 bg-custom-primary-100/10 text-custom-primary-100"
                  : "border-custom-border-200 bg-custom-background-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="date"
            className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1 text-xs"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
          {targetDate ? (
            <button
              type="button"
              onClick={() => setTargetDate("")}
              className="text-xs text-custom-text-400 underline"
            >
              清除
            </button>
          ) : null}
        </div>
      </div>

      {/* Priority */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">优先级</span>
        <select
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        >
          <option value="none">无</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="urgent">紧急</option>
        </select>
      </label>

      {/* Assignee searchable picker (workspace can have hundreds of members
          so a plain <select> is unusable). */}
      <div className="relative mb-3 flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">负责人</span>
        <input
          type="text"
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          placeholder="输入姓名搜索..."
          value={
            assigneeOpen
              ? assigneeQuery
              : memberOptions.find((m) => m.id === assigneeId)?.name ??
                currentUser?.display_name ??
                currentUser?.email ??
                ""
          }
          onFocus={() => {
            setAssigneeOpen(true);
            setAssigneeQuery("");
          }}
          onChange={(e) => setAssigneeQuery(e.target.value)}
          onBlur={() => {
            // Delay so click on option fires first.
            window.setTimeout(() => setAssigneeOpen(false), 150);
          }}
        />
        {assigneeOpen ? (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded border border-custom-border-200 bg-custom-background-100 shadow">
            {(() => {
              const q = assigneeQuery.trim().toLowerCase();
              const filtered = q
                ? memberOptions.filter((m) => m.name.toLowerCase().includes(q))
                : memberOptions;
              if (filtered.length === 0) {
                return (
                  <div className="px-2 py-2 text-xs text-custom-text-400">
                    {memberOptions.length === 0 ? "成员加载中..." : "无匹配"}
                  </div>
                );
              }
              return filtered.slice(0, 50).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-custom-background-90 ${
                    m.id === assigneeId ? "bg-custom-background-90" : ""
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAssigneeId(m.id);
                    setAssigneeOpen(false);
                  }}
                >
                  {m.name}
                </button>
              ));
            })()}
          </div>
        ) : null}
      </div>

      {source?.sender?.open_id ? (
        <p className="mb-3 text-xs text-custom-text-400">
          ↪ 来自 Lark 消息 · 发件人 {source.sender.open_id.slice(0, 8)}…
        </p>
      ) : null}
      </div>

      {/* Sticky footer so Create/Cancel stay visible even when content overflows. */}
      <div className="sticky bottom-0 flex gap-2 border-t border-custom-border-200 bg-custom-background-100 p-3">
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={submitting || !title.trim() || !projectId}
        >
          {submitting ? "创建中…" : "创建任务"}
        </Button>
        <Button variant="neutral-primary" onClick={() => window.tt?.closeWindow?.()}>
          取消
        </Button>
      </div>
    </div>
  );
});

export default LarkQuickCreatePage;
