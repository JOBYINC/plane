/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayProperties } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import { SpreadSheetPropertyIcon } from "../../utils";
import type { TListColumnContext, TListColumnKey } from "./list-columns";
import { getCustomListColumns, getListGridTemplateWithCustom, getVisibleListColumns } from "./list-columns";

interface Props {
  displayProperties: IIssueDisplayProperties | undefined;
  context: TListColumnContext;
}

export const LIST_HEADER_HEIGHT_CLASS = "h-9";
export const LIST_HEADER_GROUP_STICKY_OFFSET_CLASS = "top-9";

export function ListHeaderRow(props: Props) {
  const { displayProperties, context } = props;
  const { t } = useTranslation();
  if (!displayProperties) return null;
  const columns = getVisibleListColumns(displayProperties, context);
  // Runtime custom-field columns (design §7) appended after built-ins, in the
  // same order getListGridTemplateWithCustom lays out their tracks.
  const customColumns = getCustomListColumns();
  const gridTemplate = getListGridTemplateWithCustom(columns);

  return (
    <Row
      className={cn(
        "sticky top-0 z-[3] flex w-full flex-shrink-0 items-center border-b border-subtle bg-layer-1 text-caption-sm-medium text-secondary",
        LIST_HEADER_HEIGHT_CLASS
      )}
    >
      <div className="grid w-full items-center gap-2" style={{ gridTemplateColumns: gridTemplate }}>
        <HeaderCell label={t("common.work_item")} />
        {columns.map((column) => (
          <HeaderCell
            key={column}
            label={t(getColumnLabelKey(column))}
            icon={SPREADSHEET_PROPERTY_DETAILS[column]?.icon}
          />
        ))}
        {customColumns.map((c) => (
          <HeaderCell key={c.key} label={c.label} />
        ))}
        <div aria-hidden />
      </div>
    </Row>
  );
}

function HeaderCell({ label, icon }: { label: string; icon?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 truncate">
      {icon && <SpreadSheetPropertyIcon iconKey={icon} className="h-3.5 w-3.5 shrink-0 text-placeholder" />}
      <span className="truncate">{label}</span>
    </div>
  );
}

function getColumnLabelKey(column: TListColumnKey): string {
  return SPREADSHEET_PROPERTY_DETAILS[column]?.i18n_title ?? column;
}
