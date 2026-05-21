# Asana List View — Implementation Plan (F1 + F2)

**Status:** Ratified by user 2026-05-17 (plain-chat, SOP Step 2).
**Branch:** `feature/custom-fields-spreadsheet` (= deployed prod line @ `97e0d34620`; has custom-field columns + row drag + Module/Cycle group-by already).
**Scope:** F1 (column drag-reorder) + F2 (column width resize) on the **List** layout. Asana-style spreadsheet feel.

## Decisions locked

- **Foundation = List layout** (NOT Spreadsheet). Rationale: phase2 design + the `list-columns.ts` / `getListGridTemplate` CSS-Grid seam were written for List; custom-field columns already integrate there. (See `docs/asana-list-architecture.md`, `docs/spreadsheet-recon.md`.)
- **Sections: OUT.** `feature/asana-sections` has unresolved bugs. Plane's native **Module / Cycle group-by** (already in List) substitutes as the "sections". No `asana-sections` merge → the `list-columns.ts` merge risk and the `0125_projectsection` migration are both avoided.
- **Persistence = Option A (backend, per-user, Asana-grade)** — chosen by user. **Implemented migration-free** by nesting `view_column_prefs` inside the existing schema-less `display_filters` `JSONField` (serializers pass arbitrary JSON through; verified no field whitelist). Survives reload + syncs across devices/login. No Django migration, no migrator step, deploy chain unchanged, low risk.
- **Net result: frontend-heavy, zero migration.** Backend touch is at most the default-factory shape; the JSONField already accepts the new key.

## Persistence shape (per phase2 §1)

```ts
type TViewColumnPrefs = {
  order?: string[]; // ordered column keys: built-in TListColumnKey OR custom field id
  widths?: Record<string, number>; // px width per column key; absent → LIST_COLUMN_WIDTHS default
};
```

Stored as `display_filters.view_column_prefs`, written via the existing
`EIssueFilterType.DISPLAY_FILTERS` → `handleDisplayFilterUpdate` channel
(the same channel PR2 sort already threads down).

## The one seam

`apps/web/core/components/issues/issue-layouts/list/columns/list-columns.ts`
— `getListGridTemplate()` (custom-fields already extended it; header + every
row share it via the `--list-cols` CSS var, so both realign for free).

## Increments (SOP Step 3 verify loop — one at a time, user verifies at :3000, then commit)

**Increment 1 — persistence layer (no visible behavior change)**

- Add `TViewColumnPrefs` type; read/write `display_filters.view_column_prefs` through the issue-filter store + `DISPLAY_FILTERS` channel.
- Wire `getListGridTemplate()` / visible-column resolution to consume `order`/`widths` with fallback to existing `LIST_COLUMN_ORDER` / `LIST_COLUMN_WIDTHS` defaults.
- Verify: List renders exactly as before (no regression); a manually-set pref round-trips through the API and survives reload.

**Increment 2 — F2 column width resize** (phase2 §3)

- ~4px resize handle on the right edge of each header cell; pointer-drag = live width; pointer-up persists `widths[colKey]` via Increment-1 layer.
- `getListGridTemplate()` uses `widths[c] ?? LIST_COLUMN_WIDTHS[c]`. Title column stays `minmax(min,1fr)` (absorbs slack like Asana). Min-width clamp ~80px.
- Verify: drag a column border → it + its rows resize; works for built-in AND custom-field columns; persists across reload and a second browser/device (server-side).

**Increment 3 — F1 column drag-reorder** (phase2 §2)

- Header cells become draggable + drop targets via `@atlaskit/pragmatic-drag-and-drop` (already used for row drag in `list/block.tsx`).
- Drop computes new order → persists `order` via Increment-1 layer. Title column pinned leftmost (non-draggable, like Asana's Task column).
- `getVisibleListColumns()` merges persisted `order` with default, filtered by displayProperties + custom-field providers.
- Verify: drag a column header → order changes for header + all rows; built-in + custom; persists across reload/device.

## Step-3 prerequisite (one-time, fresh clone)

`pnpm install` + start local stack (`apps/api/cf_local_stack.py` Postgres + Django API + web dev server) so `:3000` works for the verify loop.

## Out of scope (explicit)

Sections/F3; column-pin beyond Title; fractional/flex column widths (Asana uses px — we use px); per-saved-View prefs (per-user-project is enough for solo internal test).
