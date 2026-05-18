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
  getListGridTemplateWithCustom,
  getOrderedCustomColumns,
  getVisibleListColumns,
  type TListColumnContext,
} from "./list-columns";
import { ListSortHeaderCell } from "./list-sort-header-cell";

interface Props {
  displayProperties: IIssueDisplayProperties | undefined;
  context: TListColumnContext;
  displayFilters?: IIssueDisplayFilterOptions | undefined;
  handleDisplayFilterUpdate?: (data: Partial<IIssueDisplayFilterOptions>) => void;
  // Supplies the responsive display (e.g. "hidden lg:flex"). Replaces the
  // static `flex` so the row is a direct child of the scroll container —
  // required for position:sticky to track the scrollport, not a short wrapper.
  visibilityClassName?: string;
}

export const LIST_HEADER_HEIGHT_CLASS = "h-9";
export const LIST_HEADER_GROUP_STICKY_OFFSET_CLASS = "top-9";

export function ListHeaderRow(props: Props) {
  const { displayProperties, context, displayFilters, handleDisplayFilterUpdate, visibilityClassName } = props;
  const { t } = useTranslation();
  if (!displayProperties) return null;
  const order = displayFilters?.view_column_prefs?.order;
  const columns = getVisibleListColumns(displayProperties, context, order);
  // Runtime custom-field columns (design §7), ordered by the same persisted
  // order array (custom subset). Header, rows and the grid template all use
  // getOrderedCustomColumns so cells line up with their tracks.
  const customColumns = getOrderedCustomColumns(order);
  const customKeys = customColumns.map((c) => c.key);
  const columnWidths = displayFilters?.view_column_prefs?.widths;
  const gridTemplate = getListGridTemplateWithCustom(columns, columnWidths, order);

  // Reorder one group and persist the FULL order = [built-in…, custom…] so a
  // built-in move never wipes the custom order and vice versa
  // (getVisibleListColumns reads the built-in subset, getOrderedCustomColumns
  // the custom subset; header + rows realign via both).
  const persistReorder = useCallback(
    (group: string[], otherGroup: string[], fromKey: string, toKey: string, edge: "left" | "right") => {
      if (!handleDisplayFilterUpdate || fromKey === toKey) return;
      const without = group.filter((c) => c !== fromKey);
      let insertAt = without.indexOf(toKey);
      if (insertAt === -1) return;
      if (edge === "right") insertAt += 1;
      const reordered = [...without.slice(0, insertAt), fromKey, ...without.slice(insertAt)];
      handleDisplayFilterUpdate({
        view_column_prefs: { ...displayFilters?.view_column_prefs, order: [...reordered, ...otherGroup] },
      });
    },
    [handleDisplayFilterUpdate, displayFilters]
  );

  // F1 (4b): built-in column drag-reorder.
  const handleColumnReorder = useCallback(
    (fromKey: string, toKey: string, edge: "left" | "right") =>
      persistReorder(columns, customKeys, fromKey, toKey, edge),
    [persistReorder, columns, customKeys]
  );

  // F1 (4c-2): custom-field column drag-reorder (built-in order preserved).
  const handleCustomColumnReorder = useCallback(
    (fromKey: string, toKey: string, edge: "left" | "right") =>
      persistReorder(customKeys, columns, fromKey, toKey, edge),
    [persistReorder, customKeys, columns]
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
        {columns.map((column) => (
          <DraggableColumnHeader key={column} columnKey={column} onReorder={handleColumnReorder}>
            <ListSortHeaderCell
              column={column}
              displayFilters={displayFilters}
              handleDisplayFilterUpdate={handleDisplayFilterUpdate}
            />
          </DraggableColumnHeader>
        ))}
        {customColumns.map((c) => (
          <DraggableColumnHeader
            key={c.key}
            columnKey={c.key}
            dndType="LIST_CUSTOM_COLUMN"
            onReorder={handleCustomColumnReorder}
          >
            <CustomColumnHeaderCell
              columnKey={c.key}
              label={c.label}
              currentWidth={columnWidths?.[c.key] ?? c.width}
              minWidth={LIST_COLUMN_MIN_WIDTH_PX}
              onCommitWidth={
                handleDisplayFilterUpdate
                  ? (w) =>
                      handleDisplayFilterUpdate({
                        view_column_prefs: {
                          ...displayFilters?.view_column_prefs,
                          widths: { ...columnWidths, [c.key]: w },
                        },
                      })
                  : undefined
              }
            />
          </DraggableColumnHeader>
        ))}
        <AddCustomFieldHeaderButton />
      </div>
    </Row>
  );
}
