/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
// components
import { Tooltip } from "@plane/propel/tooltip";
import { getLuminance, hexToRgb } from "@plane/utils";
import { usePlatformOS } from "@/hooks/use-platform-os";

type Props = {
  labelDetails: any[];
  maxRender?: number;
};

const LABEL_FALLBACK_COLOR = "#6b7280";

/**
 * Asana-style label pill: solid fill of the label colour, fully rounded,
 * text in a contrasting colour (near-black on light colours like yellow,
 * white on saturated/dark ones) — no border, no separate colour dot.
 */
export function labelPillStyle(color?: string | null): React.CSSProperties {
  const bg = color || LABEL_FALLBACK_COLOR;
  let textColor = "#ffffff";
  try {
    // luminance > 0.6 => light background (e.g. yellow) => dark text
    if (getLuminance(hexToRgb(bg)) > 0.6) textColor = "#1f2937";
  } catch {
    // malformed colour -> keep white on the fallback grey
  }
  return { backgroundColor: bg, color: textColor };
}

export const LABEL_PILL_CLASS =
  "inline-flex flex-shrink-0 cursor-default items-center rounded-full px-2 py-[7px] text-11 font-medium leading-tight";

export function ViewIssueLabel({ labelDetails, maxRender = 1 }: Props) {
  const { isMobile } = usePlatformOS();
  if (!labelDetails || labelDetails.length === 0) return null;

  if (labelDetails.length <= maxRender) {
    return (
      <>
        {labelDetails.map((label) => (
          <div key={label.id} className={LABEL_PILL_CLASS} style={labelPillStyle(label?.color)}>
            <Tooltip position="top" tooltipHeading="Label" tooltipContent={label.name} isMobile={isMobile}>
              <span className="truncate">{label.name}</span>
            </Tooltip>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="inline-flex flex-shrink-0 cursor-default items-center rounded-full bg-layer-1 px-2 py-[7px] text-11 leading-tight font-medium text-secondary">
      <Tooltip
        position="top"
        tooltipHeading="Labels"
        tooltipContent={labelDetails.map((l) => l.name).join(", ")}
        isMobile={isMobile}
      >
        <span>{`${labelDetails.length} Labels`}</span>
      </Tooltip>
    </div>
  );
}
