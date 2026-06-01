/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IState } from "@plane/types";

export type TMarkCompleteTarget = {
  /** whether the issue's current state belongs to the "completed" group */
  isCompleted: boolean;
  /** the state to move the issue into on the next toggle, or undefined if not actionable */
  targetStateId: string | undefined;
};

/**
 * Resolves the Asana-style "mark complete" toggle for an issue.
 *
 * - When the issue is NOT completed, the target is the first project state in
 *   the "completed" group (ordered by the store's sort).
 * - When the issue IS completed, the target is the project's default state,
 *   falling back to the first non-completed state so we never re-complete it.
 *
 * Returns an undefined `targetStateId` when no suitable state exists (e.g. a
 * project with no completed state, or a completed issue with only completed
 * states) so callers can hide or disable the control.
 */
export const getMarkCompleteTarget = (
  projectStates: IState[] | undefined,
  stateId: string | null | undefined,
  defaultStateId: string | undefined
): TMarkCompleteTarget => {
  if (!projectStates || projectStates.length === 0) return { isCompleted: false, targetStateId: undefined };

  const currentState = projectStates.find((state) => state.id === stateId);
  const isCompleted = currentState?.group === "completed";

  if (isCompleted) {
    const defaultState = projectStates.find((state) => state.id === defaultStateId);
    const reopenStateId =
      defaultState && defaultState.group !== "completed"
        ? defaultState.id
        : projectStates.find((state) => state.group !== "completed")?.id;
    return { isCompleted, targetStateId: reopenStateId };
  }

  const completedStateId = projectStates.find((state) => state.group === "completed")?.id;
  return { isCompleted, targetStateId: completedStateId };
};
