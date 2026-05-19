/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

export default function LarkQuickCreateLayout() {
  return (
    <AuthenticationWrapper>
      <Outlet />
    </AuthenticationWrapper>
  );
}

// Brand-only (language-neutral): a router MetaFunction runs outside the
// React/i18n context, so we avoid a hardcoded localized word here.
export const meta: Route.MetaFunction = () => [{ title: "Tick" }];
