/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { Calendar, CircleDot, Hash, ListChecks, Type, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TWorkItemFieldType } from "@plane/types";

// Asana-style per-type glyphs so a field reads as its type at a glance
// (settings list, peek label). Kept in one place so list/peek stay in sync.
const ICON_BY_TYPE: Record<TWorkItemFieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  date: Calendar,
  single_select: CircleDot,
  multi_select: ListChecks,
  people: Users,
};

interface FieldTypeIconProps {
  type: TWorkItemFieldType;
  className?: string;
}

export function FieldTypeIcon({ type, className = "size-3.5" }: FieldTypeIconProps) {
  const Icon = ICON_BY_TYPE[type] ?? Type;
  return <Icon className={className} />;
}
