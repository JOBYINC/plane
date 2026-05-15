/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import type { TListColumnContext } from "./list-columns";
import { getCustomListColumns, getListGridTemplateWithCustom, getVisibleListColumns } from "./list-columns";
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
  const columns = getVisibleListColumns(displayProperties, context);
  // Runtime custom-field columns (design §7) appended after built-ins, in the
  // same order getListGridTemplateWithCustom lays out their tracks. Custom
  // fields are not sortable yet (sort UI gated on PR2's menu — design §10),
  // so they render as plain label headers, not ListSortHeaderCell.
  const customColumns = getCustomListColumns();
  const gridTemplate = getListGridTemplateWithCustom(columns);

  return (
    <Row
      className={cn(
        "sticky top-0 z-[3] w-full flex-shrink-0 items-center border-b border-subtle bg-layer-1 text-caption-sm-medium text-secondary",
        visibilityClassName ?? "flex",
        LIST_HEADER_HEIGHT_CLASS
      )}
    >
      <div className="grid w-full items-center gap-2" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <span className="truncate">{t("common.work_item")}</span>
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
          <div key={c.key} className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="truncate">{c.label}</span>
          </div>
        ))}
        <div aria-hidden />
      </div>
    </Row>
  );
}
