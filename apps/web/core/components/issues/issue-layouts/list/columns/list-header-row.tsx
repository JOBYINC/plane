/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import { AddCustomFieldHeaderButton, CustomColumnHeaderCell } from "@/components/work-item-fields";
import { ColumnResizeHandle } from "./column-resize-handle";
import { DraggableColumnHeader } from "./draggable-column-header";
import {
  LIST_COLUMN_MIN_WIDTH_PX,
  TITLE_COLUMN_KEY,
  TITLE_COLUMN_MIN_WIDTH_PX,
  getHiddenCustomColumns,
  getOrderedListColumns,
  getUnifiedListGridTemplate,
  type TListColumnContext,
} from "./list-columns";
import { ListSortHeaderCell } from "./list-sort-header-cell";

interface Props {
  displayProperties: IIssueDisplayProperties | undefined;
  context: TListColumnContext;
  displayFilters?: IIssueDisplayFilterOptions | undefined;
  handleDisplayFilterUpdate?: (data: Partial<IIssueDisplayFilterOptions>) => void;
  handleDisplayPropertiesUpdate?: (data: Partial<IIssueDisplayProperties>) => void;
  // Supplies the responsive display (e.g. "hidden lg:flex"). Replaces the
  // static `flex` so the row is a direct child of the scroll container —
  // required for position:sticky to track the scrollport, not a short wrapper.
  visibilityClassName?: string;
}

export const LIST_HEADER_HEIGHT_CLASS = "h-9";
export const LIST_HEADER_GROUP_STICKY_OFFSET_CLASS = "top-9";

export function ListHeaderRow(props: Props) {
  const {
    displayProperties,
    context,
    displayFilters,
    handleDisplayFilterUpdate,
    handleDisplayPropertiesUpdate,
    visibilityClassName,
  } = props;
  const { t } = useTranslation();
  if (!displayProperties) return null;
  const order = displayFilters?.view_column_prefs?.order;
  const hidden = displayFilters?.view_column_prefs?.hidden;
  // ONE unified ordered column sequence: built-in + custom intermixed (Inc A),
  // minus hidden custom columns (B2). Header, rows and the grid template all
  // consume this so every cell lines up with its track.
  const orderedColumns = getOrderedListColumns(displayProperties, context, order, hidden);
  const columnKeys = orderedColumns.map((d) => d.key);
  const columnWidths = displayFilters?.view_column_prefs?.widths;
  const gridTemplate = getUnifiedListGridTemplate(orderedColumns, columnWidths);
  // Custom fields currently hidden — surfaced in the "+" menu so hide is
  // reversible from the list UI (no Display-dropdown entry for custom fields).
  const hiddenCustomColumns = getHiddenCustomColumns(hidden);

  // Hide / show a custom-field column for this user (view_column_prefs.hidden,
  // DISPLAY_FILTERS channel). Built-in columns hide via displayProperties (B1).
  const hideCustomColumn = useCallback(
    (key: string) => {
      if (!handleDisplayFilterUpdate) return;
      const next = Array.from(new Set([...(hidden ?? []), key]));
      handleDisplayFilterUpdate({
        view_column_prefs: { ...displayFilters?.view_column_prefs, hidden: next },
      });
    },
    [handleDisplayFilterUpdate, displayFilters, hidden]
  );

  const showCustomColumn = useCallback(
    (key: string) => {
      if (!handleDisplayFilterUpdate) return;
      const next = (hidden ?? []).filter((k) => k !== key);
      handleDisplayFilterUpdate({
        view_column_prefs: { ...displayFilters?.view_column_prefs, hidden: next },
      });
    },
    [handleDisplayFilterUpdate, displayFilters, hidden]
  );

  // Reorder within the single unified sequence and persist the full order.
  // The rendered key list IS the source of truth, so the move is a plain
  // splice — built-in and custom intermix with no group split.
  const handleColumnReorder = useCallback(
    (fromKey: string, toKey: string, edge: "left" | "right") => {
      if (!handleDisplayFilterUpdate || fromKey === toKey) return;
      const without = columnKeys.filter((c) => c !== fromKey);
      let insertAt = without.indexOf(toKey);
      if (insertAt === -1) return;
      if (edge === "right") insertAt += 1;
      const reordered = [...without.slice(0, insertAt), fromKey, ...without.slice(insertAt)];
      handleDisplayFilterUpdate({
        view_column_prefs: { ...displayFilters?.view_column_prefs, order: reordered },
      });
    },
    [handleDisplayFilterUpdate, displayFilters, columnKeys]
  );

  return (
    <Row
      className={cn(
        // min-w-full w-max: span the full --list-cols content width so the
        // header still covers custom-field columns when scrolled right
        // (mirrors the rows wrapper in blocks-list.tsx).
        "sticky top-0 z-[3] w-max min-w-full flex-shrink-0 items-center border-b border-subtle bg-layer-1 text-caption-sm-medium text-secondary",
        visibilityClassName ?? "flex",
        LIST_HEADER_HEIGHT_CLASS
      )}
    >
      <div
        className="grid w-full items-center gap-2 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-subtle"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="relative flex min-w-0 items-center gap-1.5 truncate">
          <span className="truncate">{t("common.work_item")}</span>
          {handleDisplayFilterUpdate && (
            <ColumnResizeHandle
              currentWidth={columnWidths?.[TITLE_COLUMN_KEY] ?? TITLE_COLUMN_MIN_WIDTH_PX}
              minWidth={TITLE_COLUMN_MIN_WIDTH_PX}
              onCommit={(w) =>
                handleDisplayFilterUpdate({
                  view_column_prefs: {
                    ...displayFilters?.view_column_prefs,
                    widths: { ...columnWidths, [TITLE_COLUMN_KEY]: w },
                  },
                })
              }
            />
          )}
        </div>
        {orderedColumns.map((d) => (
          <DraggableColumnHeader key={d.key} columnKey={d.key} onReorder={handleColumnReorder}>
            {d.kind === "builtin" ? (
              <ListSortHeaderCell
                column={d.key}
                displayFilters={displayFilters}
                handleDisplayFilterUpdate={handleDisplayFilterUpdate}
                handleDisplayPropertiesUpdate={handleDisplayPropertiesUpdate}
              />
            ) : (
              <CustomColumnHeaderCell
                columnKey={d.key}
                label={d.col.label}
                currentWidth={columnWidths?.[d.key] ?? d.col.width}
                minWidth={LIST_COLUMN_MIN_WIDTH_PX}
                onHide={handleDisplayFilterUpdate ? () => hideCustomColumn(d.key) : undefined}
                onCommitWidth={
                  handleDisplayFilterUpdate
                    ? (w) =>
                        handleDisplayFilterUpdate({
                          view_column_prefs: {
                            ...displayFilters?.view_column_prefs,
                            widths: { ...columnWidths, [d.key]: w },
                          },
                        })
                    : undefined
                }
              />
            )}
          </DraggableColumnHeader>
        ))}
        <AddCustomFieldHeaderButton
          hiddenColumns={hiddenCustomColumns}
          onShow={handleDisplayFilterUpdate ? showCustomColumn : undefined}
        />
      </div>
    </Row>
  );
}
