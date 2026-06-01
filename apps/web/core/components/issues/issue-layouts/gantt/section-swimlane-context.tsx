/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext } from "react";

/**
 * Shared state for Gantt section swimlanes.
 *
 * The header rows are rendered by the *generic* gantt components (sidebar /
 * block-row-list), which know nothing about sections. Rather than thread
 * collapse state + section metadata through every existing prop chain, the
 * BaseGanttRoot provides it via this context and the header rows consume it
 * directly. `enabled` is false for every non-section grouping so the generic
 * components behave exactly as before.
 */

export type TSwimlaneSection = {
  /** group id = ProjectSection id, or the synthetic "None" bucket. */
  id: string;
  name: string;
  /** number of issue rows in this section (for the header count). */
  count: number;
  /** Asana-style tint derived client-side from the section's order. */
  color: string;
};

/** Default Gantt sidebar width (mirrors gantt-chart/constants SIDEBAR_WIDTH). */
export const DEFAULT_GANTT_SIDEBAR_WIDTH = 360;
/** Narrow sidebar for swimlane mode: section label + ~20px gap, no task column. */
export const SWIMLANE_SIDEBAR_WIDTH = 210;

export type TSectionSwimlaneContext = {
  enabled: boolean;
  /** sidebar width to use (narrow in swimlane mode, default otherwise). */
  sidebarWidth: number;
  /** ordered section group ids → metadata (name/count/color). */
  sectionsById: Record<string, TSwimlaneSection>;
  /** group ids whose issue rows are currently hidden. */
  collapsedIds: Set<string>;
  toggleCollapse: (groupId: string) => void;
  /** issue section_id (or null) → tint, for per-section bar colour. */
  getColorForSection: (sectionId: string | null | undefined) => string | undefined;
};

const DEFAULT_CONTEXT: TSectionSwimlaneContext = {
  enabled: false,
  sidebarWidth: DEFAULT_GANTT_SIDEBAR_WIDTH,
  sectionsById: {},
  collapsedIds: new Set(),
  toggleCollapse: () => {},
  getColorForSection: () => undefined,
};

export const SectionSwimlaneContext = createContext<TSectionSwimlaneContext>(DEFAULT_CONTEXT);

export const useSectionSwimlane = (): TSectionSwimlaneContext => useContext(SectionSwimlaneContext);
