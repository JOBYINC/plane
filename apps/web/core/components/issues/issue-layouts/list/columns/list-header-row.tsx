/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import { AddCustomFieldHeaderButton, CustomColumnHeaderCell } from "@/components/work-item-fields";
import { ColumnResizeHandle } from "./column-resize-handle";
import {
  TITLE_COLUMN_KEY,
  TITLE_COLUMN_MIN_WIDTH_PX,
  getCustomListColumns,
  getListGridTemplateWithCustom,
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
  const columns = getVisibleListColumns(displayProperties, context, displayFilters?.view_column_prefs?.order);
  // Runtime custom-field columns (design §7) appended after built-ins, in the
  // same order getListGridTemplateWithCustom lays out their tracks. Custom
  // fields are not sortable yet (sort UI gated on PR2's menu — design §10),
  // so they render as plain label headers, not ListSortHeaderCell.
  const customColumns = getCustomListColumns();
  const columnWidths = displayFilters?.view_column_prefs?.widths;
  const gridTemplate = getListGridTemplateWithCustom(columns, columnWidths);

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
          <ListSortHeaderCell
            key={column}
            column={column}
            displayFilters={displayFilters}
            handleDisplayFilterUpdate={handleDisplayFilterUpdate}
          />
        ))}
        {customColumns.map((c) => (
          <CustomColumnHeaderCell key={c.key} columnKey={c.key} label={c.label} />
        ))}
        <AddCustomFieldHeaderButton />
      </div>
    </Row>
  );
}
