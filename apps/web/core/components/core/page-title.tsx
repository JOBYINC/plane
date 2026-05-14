/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";

type PageHeadTitleProps = {
  title?: string;
  description?: string;
};

// When Tick runs inside Lark's 网页应用 iframe, Lark mirrors document.title
// into its left-nav app label — so every route change relabels the icon
// ("Your stickies", "My issues", project name...). Pin the iframe title to
// the brand name so users always see "Tick · 任务管理" in Lark's sidebar,
// while keeping per-page tab titles for standalone-browser sessions.
const BRAND_TITLE = "Tick · 任务管理";

function isEmbeddedInLark() {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access throws -> we ARE in an iframe (typical Lark webapp case).
    return true;
  }
}

export function PageHead(props: PageHeadTitleProps) {
  const { title } = props;

  useEffect(() => {
    if (isEmbeddedInLark()) {
      document.title = BRAND_TITLE;
      return;
    }
    if (title) {
      document.title = title;
    }
  }, [title]);

  return null;
}
