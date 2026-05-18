/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDownIcon, Eraser, EyeOff, MoveRight } from "lucide-react";
import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssueOrderByOptions } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
import { SpreadSheetPropertyIcon } from "../../utils";
import { ColumnResizeHandle } from "./column-resize-handle";
import {
  LIST_COLUMN_MIN_WIDTH_PX,
  LIST_COLUMN_WIDTHS,
  getDisplayPropertyKey,
  type TListColumnKey,
} from "./list-columns";

// Clearing a column sort returns the list to manual drag order.
const CLEAR_ORDER_BY: TIssueOrderByOptions = "sort_order";

interface Props {
  column: TListColumnKey;
  displayFilters: IIssueDisplayFilterOptions | undefined;
  handleDisplayFilterUpdate?: (data: Partial<IIssueDisplayFilterOptions>) => void;
  handleDisplayPropertiesUpdate?: (data: Partial<IIssueDisplayProperties>) => void;
}

export function ListSortHeaderCell(props: Props) {
  const { column, displayFilters, handleDisplayFilterUpdate, handleDisplayPropertiesUpdate } = props;
  const { t } = useTranslation();

  const details = SPREADSHEET_PROPERTY_DETAILS[column];
  if (!details) return null;

  const { ascendingOrderKey, descendingOrderKey, ascendingOrderTitle, descendingOrderTitle, icon, i18n_title } =
    details;
  const currentOrderBy = displayFilters?.order_by;
  const isAscActive = currentOrderBy === ascendingOrderKey;
  const isDescActive = currentOrderBy === descendingOrderKey;
  const isSortedByThisColumn = isAscActive || isDescActive;

  // If the parent didn't pass an update handler, render a static (non-clickable)
  // label so the header still aligns with the grid.
  if (!handleDisplayFilterUpdate) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 truncate">
        {icon && <SpreadSheetPropertyIcon iconKey={icon} className="h-3.5 w-3.5 shrink-0 text-placeholder" />}
        <span className="truncate">{t(i18n_title)}</span>
      </div>
    );
  }

  const setOrderBy = (order: TIssueOrderByOptions) => handleDisplayFilterUpdate({ order_by: order });

  // F2: persist the new px width into display_filters.view_column_prefs so it
  // survives reload and syncs per user (no schema migration — rides the
  // existing display_filters JSON).
  const columnWidths = displayFilters?.view_column_prefs?.widths;
  const currentWidth = columnWidths?.[column] ?? LIST_COLUMN_WIDTHS[column];
  const commitWidth = (newWidth: number) =>
    handleDisplayFilterUpdate({
      view_column_prefs: {
        ...displayFilters?.view_column_prefs,
        widths: { ...columnWidths, [column]: newWidth },
      },
    });

  return (
    <div className="relative flex w-full items-center">
      <CustomMenu
        customButtonClassName="clickable !w-full"
        customButtonTabIndex={-1}
        className="!w-full"
        customButton={
          <div className="flex w-full cursor-pointer items-center justify-between gap-1.5 text-secondary hover:text-primary">
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              {icon && <SpreadSheetPropertyIcon iconKey={icon} className="h-3.5 w-3.5 shrink-0 text-placeholder" />}
              <span className="truncate">{t(i18n_title)}</span>
            </div>
            <div className="ml-1 flex shrink-0 items-center">
              {isSortedByThisColumn && (
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  {isAscActive ? (
                    <ArrowDownWideNarrow className="h-3 w-3" />
                  ) : (
                    <ArrowUpNarrowWide className="h-3 w-3" />
                  )}
                </span>
              )}
              <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
            </div>
          </div>
        }
        placement="bottom-start"
        closeOnSelect
      >
        <CustomMenu.MenuItem onClick={() => setOrderBy(ascendingOrderKey)}>
          <div
            className={cn("flex items-center justify-between gap-1.5 px-1", {
              "text-primary": isAscActive,
              "text-secondary hover:text-primary": !isAscActive,
            })}
          >
            <div className="flex items-center gap-2">
              <ArrowDownWideNarrow className="h-3 w-3 stroke-[1.5]" />
              <span>{ascendingOrderTitle}</span>
              <MoveRight className="h-3 w-3" />
              <span>{descendingOrderTitle}</span>
            </div>
          </div>
        </CustomMenu.MenuItem>
        <CustomMenu.MenuItem onClick={() => setOrderBy(descendingOrderKey)}>
          <div
            className={cn("flex items-center justify-between gap-1.5 px-1", {
              "text-primary": isDescActive,
              "text-secondary hover:text-primary": !isDescActive,
            })}
          >
            <div className="flex items-center gap-2">
              <ArrowUpNarrowWide className="h-3 w-3 stroke-[1.5]" />
              <span>{descendingOrderTitle}</span>
              <MoveRight className="h-3 w-3" />
              <span>{ascendingOrderTitle}</span>
            </div>
          </div>
        </CustomMenu.MenuItem>
        {isSortedByThisColumn && (
          <CustomMenu.MenuItem className="mt-0.5" onClick={() => setOrderBy(CLEAR_ORDER_BY)}>
            <div className="flex items-center gap-2 px-1">
              <Eraser className="h-3 w-3" />
              <span>{t("common.actions.clear_sorting")}</span>
            </div>
          </CustomMenu.MenuItem>
        )}
        {handleDisplayPropertiesUpdate && (
          <CustomMenu.MenuItem
            className="mt-0.5"
            onClick={() => handleDisplayPropertiesUpdate({ [getDisplayPropertyKey(column)]: false })}
          >
            <div className="flex items-center gap-2 px-1">
              <EyeOff className="h-3 w-3" />
              <span>{t("common.actions.hide_field")}</span>
            </div>
          </CustomMenu.MenuItem>
        )}
      </CustomMenu>
      <ColumnResizeHandle currentWidth={currentWidth} minWidth={LIST_COLUMN_MIN_WIDTH_PX} onCommit={commitWidth} />
    </div>
  );
}
