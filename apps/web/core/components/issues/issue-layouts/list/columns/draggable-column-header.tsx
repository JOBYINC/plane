/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { cn } from "@plane/utils";

const COLUMN_DND_TYPE = "LIST_COLUMN";
// Same explicit Asana blue as the resize affordance (Plane's primary token
// is a near-black neutral, not blue).
const DROP_INDICATOR_BLUE = "#3b82f6";

type Edge = "left" | "right";

interface DraggableColumnHeaderProps {
  columnKey: string;
  /** Reorder: move `fromKey` to the `edge` side of this column (`columnKey`). */
  onReorder: (fromKey: string, toKey: string, edge: Edge) => void;
  children: ReactNode;
}

/**
 * F1: wraps a built-in column header so it can be dragged to reorder columns.
 * Reuses the same pragmatic-drag-and-drop adapter as row drag. A blue bar on
 * the near edge marks where the dragged column will drop. The Title column is
 * NOT wrapped (pinned first, like Asana's Task column); the click-to-sort
 * menu and the resize grip still work (drag only starts past a threshold; the
 * resize grip stops pointer propagation).
 */
export function DraggableColumnHeader(props: DraggableColumnHeaderProps) {
  const { columnKey, onReorder, children } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const edgeRef = useRef<Edge | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: COLUMN_DND_TYPE, columnKey }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === COLUMN_DND_TYPE && source.data.columnKey !== columnKey,
        getData: () => ({ type: COLUMN_DND_TYPE, columnKey }),
        onDrag: ({ location }) => {
          const rect = el.getBoundingClientRect();
          const next: Edge = location.current.input.clientX < rect.left + rect.width / 2 ? "left" : "right";
          edgeRef.current = next;
          setEdge(next);
        },
        onDragLeave: () => {
          edgeRef.current = null;
          setEdge(null);
        },
        onDrop: ({ source }) => {
          const fromKey = source.data.columnKey;
          if (typeof fromKey === "string" && edgeRef.current) onReorder(fromKey, columnKey, edgeRef.current);
          edgeRef.current = null;
          setEdge(null);
        },
      })
    );
  }, [columnKey, onReorder]);

  return (
    <div ref={ref} className={cn("relative flex h-full w-full cursor-grab items-center", isDragging && "opacity-50")}>
      {children}
      {edge && (
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-y-0 z-[5] w-0.5", edge === "left" ? "left-0" : "right-0")}
          style={{ backgroundColor: DROP_INDICATOR_BLUE }}
        />
      )}
    </div>
  );
}
