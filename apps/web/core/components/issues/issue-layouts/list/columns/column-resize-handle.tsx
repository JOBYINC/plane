/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { PointerEvent } from "react";
import { useRef, useState } from "react";
import { cn } from "@plane/utils";

interface ColumnResizeHandleProps {
  /** The column's current effective width in px (start of a drag). */
  currentWidth: number;
  /** Lower clamp so a column can't be dragged to nothing. */
  minWidth: number;
  /** Called once, on pointer-up, with the final clamped width. */
  onCommit: (newWidth: number) => void;
}

/**
 * A ~4px grab strip on the right edge of a list header cell. Increment 1
 * commits the new width on pointer-up (no live grid preview yet — that is the
 * follow-up polish increment); the parent persists it into
 * display_filters.view_column_prefs so it survives reload + syncs per user.
 */
export function ColumnResizeHandle(props: ColumnResizeHandleProps) {
  const { currentWidth, minWidth, onCommit } = props;
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Stop the click from bubbling into the header's sort menu / sort toggle.
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { startX: e.clientX, startWidth: currentWidth, width: currentWidth };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    const next = Math.max(minWidth, Math.round(state.startWidth + (e.clientX - state.startX)));
    dragState.current = { ...state, width: next };
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragState.current = null;
    setIsDragging(false);
    if (state.width !== state.startWidth) onCommit(state.width);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "absolute inset-y-0 right-0 z-[4] w-1 cursor-col-resize touch-none select-none",
        "hover:bg-primary/40",
        isDragging && "bg-primary/60"
      )}
    />
  );
}
