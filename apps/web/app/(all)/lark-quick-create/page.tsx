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

// CN region CDN — more reliable for feishu.cn clients than the bytegoofy
// fallback. If load fails we retry on bytegoofy.com.
const H5_SDK_URLS = [
  "https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.34.js",
  "https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.23.js",
];
// DIAGNOSTIC: start with the bare-minimum list to isolate errno 104.
// closeWindow is the JSAPI documented as universally available on web_app.
// If config succeeds with just this, errno 104 was caused by something
// else in our previous jsApiList. We add getBlockActionSourceDetail back
// in a follow-up commit once we know which entry was the culprit.
const JS_API_LIST = ["closeWindow"];
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

const LarkQuickCreatePage = observer(() => {
  const { workspaces } = useWorkspace();
  const { joinedProjectIds, getProjectById } = useProject();
  const { data: currentUser } = useUser();

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [diagInfo, setDiagInfo] = useState<Record<string, unknown>>({});
  const [source, setSource] = useState<LarkSourceDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
                  console.log("[lark-quick-create] source detail:", res);
                  const detail =
                    (res as { detail?: LarkSourceDetail } | undefined)?.detail ?? null;
                  setSource(detail);
                  const prefill = deriveTitle(detail?.content?.text ?? detail?.content?.title);
                  setTitle(prefill);
                  setDescription(detail?.content?.text ?? "");
                  resolve();
                },
                fail: (err: unknown) => {
                  // eslint-disable-next-line no-console
                  console.error("[lark-quick-create] getBlockActionSourceDetail fail:", err);
                  resolve();
                },
              });
            });
          }
        }

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
    if (!projectId && joinedProjectIds.length > 0) setProjectId(joinedProjectIds[0]);
  }, [joinedProjectIds, projectId]);

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
      await issueService.createIssue(workspace.slug, projectId, {
        name: title.trim(),
        description_html: description ? `<p>${escapeHtml(description)}</p>` : "<p></p>",
        assignee_ids: [currentUser.id],
      });
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
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">新建 Tick 任务</h1>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-custom-text-300">项目</span>
        <select
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {joinedProjectIds.map((id) => {
            const p = getProjectById(id);
            return (
              <option key={id} value={id}>
                {p?.name ?? id}
              </option>
            );
          })}
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
          rows={5}
          className="rounded border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="任务详情（可选）"
        />
      </label>

      {source?.sender?.open_id ? (
        <p className="text-xs text-custom-text-400">
          来自 Lark 消息 · 发件人 {source.sender.open_id.slice(0, 8)}…
        </p>
      ) : null}

      <div className="mt-2 flex gap-2">
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
