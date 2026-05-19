/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Browser polyfills (requestIdleCallback/cancelIdleCallback for WebKit/Safari
// < 17.4). Side-effect import — must run before any component mounts.
// eslint-disable-next-line import/no-unassigned-import
import "@/lib/polyfills";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
