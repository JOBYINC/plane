/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { PointerEvent } from "react";
import { useRef, useState } from "react";
import { cn } from "@plane/utils";

// Plane's `primary` token is a near-black neutral, not blue. Use an explicit
// Asana-style blue so the affordance reads clearly in light and dark themes.
const RESIZE_GUIDE_BLUE = "#3b82f6";

interface ColumnResizeHandleProps {
  /** The column's current effective width in px (start of a drag). */
  currentWidth: number;
  /** Lower clamp so a column can't be dragged to nothing. */
  minWidth: number;
  /** Called once, on pointer-up, with the final clamped width. */
  onCommit: (newWidth: number) => void;
}

type DragState = {
  startX: number;
  startWidth: number;
  width: number;
  // Viewport x past which the column would go below minWidth (the clamp line).
  minLineX: number;
};

// The full-height blue guide line drawn over the list while dragging — bounds
// come from the scroll container (marked with data-list-grid in default.tsx).
type GuideRect = { top: number; height: number; x: number };

/**
 * Asana-style column resize grip on the right edge of a list header cell.
 *
 * - Hover: a blue line on the column boundary (the spreadsheet-resize affordance).
 * - Drag: a blue guide line spans the whole list and tracks the cursor
 *   (clamped at minWidth); the column snaps to it on pointer-up, and the
 *   parent persists the width into display_filters.view_column_prefs (no
 *   schema migration, per-user, survives reload + syncs across devices).
 */
export function ColumnResizeHandle(props: ColumnResizeHandleProps) {
  const { currentWidth, minWidth, onCommit } = props;
  const [isDragging, setIsDragging] = useState(false);
  const [guide, setGuide] = useState<GuideRect | null>(null);
  const dragState = useRef<DragState | null>(null);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Stop the click from bubbling into the header's sort menu.
    e.preventDefault();
    e.stopPropagation();
    const container = e.currentTarget.closest<HTMLElement>("[data-list-grid]");
    const rect = container?.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startWidth: currentWidth,
      width: currentWidth,
      minLineX: e.clientX - (currentWidth - minWidth),
    };
    setIsDragging(true);
    setGuide({
      top: rect?.top ?? 0,
      height: rect?.height ?? window.innerHeight,
      x: e.clientX,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    const next = Math.max(minWidth, Math.round(state.startWidth + (e.clientX - state.startX)));
    dragState.current = { ...state, width: next };
    setGuide((g) => (g ? { ...g, x: Math.max(state.minLineX, e.clientX) } : g));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragState.current = null;
    setIsDragging(false);
    setGuide(null);
    if (state.width !== state.startWidth) onCommit(state.width);
  };

  return (
    <>
      {/* Hit strip: a few px wide and nudged into the gutter for an easy grab. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="group/resize absolute inset-y-0 -right-1 z-[4] flex w-2 cursor-col-resize touch-none justify-end select-none"
      >
        {/* The blue boundary line: visible on hover, brighter while dragging. */}
        <span
          style={{ backgroundColor: RESIZE_GUIDE_BLUE }}
          className={cn(
            "h-full w-1.5 rounded-full opacity-0 transition-opacity",
            "group-hover/resize:opacity-100",
            isDragging && "opacity-100"
          )}
        />
      </div>
      {/* Full-height guide line over the whole list, tracking the cursor. */}
      {guide && (
        <div
          className="pointer-events-none fixed z-[60] w-0.5"
          style={{ top: guide.top, height: guide.height, left: guide.x, backgroundColor: RESIZE_GUIDE_BLUE }}
        />
      )}
    </>
  );
}
