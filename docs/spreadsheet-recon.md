# Spreadsheet Custom-Fields Recon

Branch: `feature/custom-fields-spreadsheet` (base: 97e0d34620)

---

## 1. Spreadsheet View Architecture

### File Inventory

| File                            | Role                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `roots/project-root.tsx`        | Entry — mounts `BaseSpreadsheetRoot` with `ProjectIssueQuickActions`                                                           |
| `roots/cycle-root.tsx`          | Same pattern, cycle-scoped store type                                                                                          |
| `roots/module-root.tsx`         | Same pattern, module-scoped store type                                                                                         |
| `roots/project-view-root.tsx`   | Same pattern, view-scoped                                                                                                      |
| `roots/workspace-root.tsx`      | Same pattern, workspace-level (no projectId)                                                                                   |
| `base-spreadsheet-root.tsx`     | Fetches issues, resolves display properties, renders `SpreadsheetView`                                                         |
| `spreadsheet-view.tsx`          | Builds `spreadsheetColumnsList`, wraps in scroll container + `MultipleSelectGroup`, renders `SpreadsheetTable`                 |
| `spreadsheet-table.tsx`         | `<table>` root; mounts sticky-shadow scroll listener; renders `SpreadsheetHeader` + `SpreadsheetIssueRow` per issue            |
| `spreadsheet-header.tsx`        | `<thead>` — one frozen `<th>` for "Work items", then maps `spreadsheetColumnsList` → `SpreadsheetHeaderColumn`                 |
| `spreadsheet-header-column.tsx` | One `<th>` per built-in property; guards via `WithDisplayPropertiesHOC`; renders `HeaderColumn`                                |
| `columns/header-column.tsx`     | Sort-menu UI for a single header cell                                                                                          |
| `issue-row.tsx`                 | `SpreadsheetIssueRow` — virtualized via `RenderIfVisible`; handles sub-issue expand; delegates row detail to `IssueRowDetails` |
| `issue-column.tsx`              | One `<td>` per built-in property; looks up `SPREADSHEET_COLUMNS[property]` for the cell renderer                               |
| `columns/` (14 files)           | One file per built-in property column (state, priority, assignee, …); each exports a `TSpreadsheetColumn` component            |
| `columns/index.ts`              | Re-exports all column components                                                                                               |

### Render Tree (root → leaf)

```
roots/project-root.tsx   (ProjectSpreadsheetLayout)
  └─ base-spreadsheet-root.tsx   (BaseSpreadsheetRoot)
       └─ spreadsheet-view.tsx   (SpreadsheetView)
            ├─ builds spreadsheetColumnsList  ← from SPREADSHEET_PROPERTY_LIST constant
            └─ spreadsheet-table.tsx   (SpreadsheetTable)
                 ├─ spreadsheet-header.tsx   (SpreadsheetHeader)
                 │    └─ [spreadsheetColumnsList.map] → spreadsheet-header-column.tsx
                 │         └─ columns/header-column.tsx  (sort menu)
                 └─ [issueIds.map] → issue-row.tsx  (SpreadsheetIssueRow)
                      └─ IssueRowDetails
                           ├─ <td> frozen first column (identifier + name)
                           └─ [spreadsheetColumnsList.map] → issue-column.tsx  (IssueColumn)
                                └─ SPREADSHEET_COLUMNS[property]  ← cell renderer
```

---

## 2. How Columns Are Defined

### Column List Source

`spreadsheet-view.tsx:72-78` — `spreadsheetColumnsList` is derived directly from the constant `SPREADSHEET_PROPERTY_LIST` (`packages/constants/src/issue/common.ts:213-228`):

```
["state","priority","assignee","labels","modules","cycle",
 "start_date","due_date","estimate","created_on","updated_on",
 "link","attachment_count","sub_issue_count"]
```

This is a static `(keyof IIssueDisplayProperties)[]`. There is no runtime-extensible provider registry in the spreadsheet — only the list layout has one (`registerListColumnProvider`).

### Column → Cell Renderer Mapping

`issue-column.tsx:32` — `const Column = SPREADSHEET_COLUMNS[property]`

`SPREADSHEET_COLUMNS` is a static record in `apps/web/ce/components/issues/issue-layouts/utils.tsx:97-112`. It maps every `keyof IIssueDisplayProperties` to a `TSpreadsheetColumn` React component. Type signature (`packages/types/src/view-props.ts:268-273`):

```ts
type TSpreadsheetColumn = React.FC<{
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
}>;
```

### Column Visibility / Order / Width

- **Visibility**: `WithDisplayPropertiesHOC` wraps each `<th>` and `<td>` and checks `displayProperties[property]`. Gating is by the `IIssueDisplayProperties` boolean flags.
- **Order**: Determined entirely by the order in `SPREADSHEET_PROPERTY_LIST`.
- **Width**: No explicit pixel-width system. Each `<th>` has `min-w-36` (9rem ≈ 144px) via Tailwind; each `<td>` has `min-w-36`. There is no programmatic width map for the spreadsheet table (unlike the list layout which uses a CSS Grid with `LIST_COLUMN_WIDTHS`).

### Comparison with List Layout Columns

| Aspect               | List Layout                                                                                   | Spreadsheet Layout                                |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Column list source   | `LIST_COLUMN_ORDER` static array + `getCustomListColumns()` runtime extension                 | `SPREADSHEET_PROPERTY_LIST` static array only     |
| Column registry      | `registerListColumnProvider` / `getCustomListColumns()` (MobX observable, runtime extensible) | None — no provider registry                       |
| Cell renderer map    | `CELL_BY_COLUMN` (`issue-cells.tsx`)                                                          | `SPREADSHEET_COLUMNS` (`ce/…/utils.tsx`)          |
| Width system         | `LIST_COLUMN_WIDTHS` px map → CSS Grid `--list-cols` var                                      | Tailwind `min-w-36` per cell                      |
| Custom field columns | Appended after built-ins via `CustomFieldColumnsBridge` + `getCustomListColumns()`            | Not implemented                                   |
| Header type          | `ListHeaderRow` with `ListSortHeaderCell` + `CustomColumnHeaderCell`                          | `SpreadsheetHeader` with `HeaderColumn` sort menu |

---

## 3. The Proven Sibling: Custom Fields in the List Layout

### Integration Points

#### 3a. Data Loading Bridge

`apps/web/core/components/work-item-fields/custom-field-columns-bridge.tsx` mounts as a side-effect component inside `list/default.tsx:158`.

- Calls `fetchProjectFields(workspaceSlug, projectId)` and `fetchProjectFieldValues(workspaceSlug, projectId)` on mount.
- Calls `registerListColumnProvider(() => buildCustomColumns(getProjectFields(projectId)))` — registers a MobX-reactive lambda that returns `TCustomListColumn[]` for the current project's active fields.
- Returns null (renders nothing).

#### 3b. Column List Extension

`list-columns.ts` exports a runtime registry (`customColumnProviders`, `customColumnsVersion` observable box). `getCustomListColumns()` reads `customColumnsVersion` (MobX dep) then flatMaps all providers. `getListGridTemplateWithCustom()` appends custom column track widths to the CSS Grid template.

#### 3c. Header Rendering

`list-header-row.tsx:65-67` — after the built-in `ListSortHeaderCell` loop, iterates `getCustomListColumns()` and renders `CustomColumnHeaderCell` per field. Admins see an edit/delete menu; non-admins see the plain label.

#### 3d. Row Cell Rendering

`list/block.tsx:357-373` — after built-in column cells, iterates `getCustomListColumns()`, resolves the `TWorkItemField` via `getFieldById(customColumnKeyToFieldId(c.key))`, and renders `WorkItemFieldCell` (from `apps/web/core/components/work-item-fields/work-item-field-cell.tsx`).

#### 3e. WorkItemFieldCell

`work-item-field-cell.tsx` — per-type renderer for one field on one issue. Uses `useWorkItemField()` for `getValueForIssue` + `upsertValue`. Field types: `text` (input), `number` (input), `date` (DateDropdown), `single_select` (inline CustomMenu), `multi_select` (inline CustomMenu multi-toggle), `people` (MemberDropdown). Wraps the whole cell in a `stopPropagation` guard because rows are `ControlLink` anchors.

### Store / Hook Chain

```
useWorkItemField()  →  StoreContext.workItemField  →  WorkItemFieldStore
  fieldMap: Record<fieldId, TWorkItemField>   (observable)
  valuesByIssue: Record<issueId, Record<fieldId, TWorkItemFieldValue>>  (observable)
  getProjectFields(projectId)   ← computedFn, sorted by sort_order
  getFieldById(fieldId)         ← computedFn
  getValueForIssue(issueId, fieldId)  ← computedFn
  fetchProjectFields / fetchProjectFieldValues / upsertValue / clearValue
```

Store is at `apps/web/core/store/work-item-field.store.ts`. Registered in `root.store.ts` as `workItemField`.

---

## 4. Data Layer

### Frontend Store

- `apps/web/core/store/work-item-field.store.ts` — `WorkItemFieldStore` / `IWorkItemFieldStore`
- `apps/web/core/hooks/store/use-work-item-field.ts` — `useWorkItemField()` hook
- Path alias `@/plane-web/*` → `./ce/*` (tsconfig.json:9)

### Frontend Service

`apps/web/core/services/work-item-field.service.ts` — `WorkItemFieldService`

| Method                  | Endpoint                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `getProjectFields`      | `GET /api/workspaces/{slug}/projects/{id}/fields/`                                     |
| `createField`           | `POST /api/workspaces/{slug}/projects/{id}/fields/`                                    |
| `updateField`           | `PATCH /api/workspaces/{slug}/projects/{id}/fields/{fieldId}/`                         |
| `deleteField`           | `DELETE /api/workspaces/{slug}/projects/{id}/fields/{fieldId}/`                        |
| `getProjectFieldValues` | `GET /api/workspaces/{slug}/projects/{id}/issue-field-values/[?issue_ids=…]`           |
| `upsertValue`           | `PUT /api/workspaces/{slug}/projects/{id}/issues/{issueId}/field-values/{fieldId}/`    |
| `clearValue`            | `DELETE /api/workspaces/{slug}/projects/{id}/issues/{issueId}/field-values/{fieldId}/` |

### Backend (Django — locate only)

- Models: `apps/api/plane/db/models/work_item_field.py` — `WorkItemField`, `WorkItemFieldOption`, `WorkItemFieldValue`
- Viewsets: `apps/api/plane/app/views/work_item_field/base.py` — `WorkItemFieldViewSet`, `WorkItemFieldOptionViewSet`, `WorkItemFieldValueViewSet`, `WorkItemFieldValueBulkEndpoint`
- URLs: `apps/api/plane/app/urls/work_item_field.py` — registered under `/api/workspaces/…`
- Serializers: `apps/api/plane/app/serializers/work_item_field.py`

The backend already serves all required endpoints; no backend work needed for this feature.

---

## 5. Spreadsheet-Specific Infrastructure

### Frozen First Column

`issue-row.tsx:267` — first `<td>` has `className="… left-0 z-10 … md:sticky"`. No fixed pixel width; it grows flexibly.

`spreadsheet-header.tsx:53-55` — first `<th>` has `className="… left-0 z-[15] h-11 min-w-60 … md:sticky"`.

The sticky behavior is pure CSS (`position: sticky; left: 0`). No JS-managed freeze mechanism.

### Horizontal Scroll + Shadow

`spreadsheet-table.tsx:70-100` — a `handleScroll` callback is attached to `containerRef` (the `<table>`'s scroll parent). On horizontal scroll, it directly mutates `box-shadow` on all `td:first-child` and `th:first-child` elements to create a shadow behind the frozen column. This uses a `isScrolled` ref (not state) to avoid re-renders.

`spreadsheet-view.tsx:93` — the scroll container div has classes `vertical-scrollbar horizontal-scrollbar scrollbar-lg h-full w-full`.

### Column Width / Span

- No colspan / width-span mechanism. Each column is a standard `<td>` with `min-w-36`.
- Unlike the list layout there is no CSS Grid; this is a plain `<table>`.
- Width cannot be computed upfront; it relies on min-width constraints and content.

### Comparison to List Layout's Width/Scroll Handling

- List: CSS Grid, explicit px widths per column, `--list-cols` CSS variable, no horizontal scroll (the container is not horizontally scrollable — all columns fit because the sidebar can collapse).
- Spreadsheet: `<table>`, `min-w-36` per column, full horizontal scroll via overflow container, JS-driven shadow on first column.

Custom field cells in the list layout use `div` grid cells (no `min-w` constraint beyond the grid track). For the spreadsheet, each new custom column `<th>` and `<td>` would inherit the same `min-w-36` as built-in columns — but the exact desired width per field type is not yet defined.

---

## 6. Gap Analysis (Factual — What Is Missing)

1. **No runtime column registry in the spreadsheet.** `spreadsheetColumnsList` is built from `SPREADSHEET_PROPERTY_LIST` (a hardcoded `keyof IIssueDisplayProperties[]`). There is no equivalent of `registerListColumnProvider` / `getCustomListColumns()` for the spreadsheet path. Custom field columns cannot be appended at runtime.

2. **`SPREADSHEET_COLUMNS` has no entry for custom field keys.** `issue-column.tsx:32-34` looks up `SPREADSHEET_COLUMNS[property]`; if the key is not in the map it returns null and renders nothing. `IIssueDisplayProperties` does not include custom field keys at all (the interface only has the 16 built-in booleans, `view-props.ts:161-178`).

3. **`SpreadsheetHeader` does not iterate custom columns.** It only maps over `spreadsheetColumnsList` (`spreadsheet-header.tsx:79-89`). There is no equivalent of the list's post-loop `customColumns.map(...)` block.

4. **`IssueRowDetails` does not iterate custom columns.** It only maps over `spreadsheetColumnsList` (`issue-row.tsx:390-400`). No custom `<td>` cells are emitted.

5. **No `CustomFieldColumnsBridge` (or equivalent) mounted in the spreadsheet.** `base-spreadsheet-root.tsx` and `spreadsheet-view.tsx` do not mount any data-hydration component for work-item-field definitions or values. The store data is never loaded for the spreadsheet view.

6. **`WorkItemFieldCell` is not imported or referenced anywhere in the spreadsheet component tree.**

7. **No custom column header component wired in.** `CustomColumnHeaderCell` and `AddCustomFieldHeaderButton` are only imported/used in `list-header-row.tsx`. The spreadsheet has no equivalent header component for custom fields.

8. **No spreadsheet-specific cell wrapper for custom fields.** `TSpreadsheetColumn` has signature `(issue, onChange, disabled, onClose)`. `WorkItemFieldCell` has signature `(field, issueId, projectId, isReadOnly)`. They are not directly compatible; a thin adapter/wrapper `<td>` is needed (analogous to `issue-column.tsx` for built-ins).

---

## 7. Open Questions

- **Column list strategy**: Should custom columns be appended to `SPREADSHEET_PROPERTY_LIST` at runtime (a provider registry mirroring the list), or injected at a different layer (e.g., `spreadsheet-view.tsx` builds an extended list alongside the built-in one)?
- **Visibility toggle**: Built-in spreadsheet columns are toggled via `IIssueDisplayProperties` booleans in display settings. Custom fields are not in that interface. Should custom columns always be visible (all active fields shown), opt-in via a separate toggle, or wired into display properties somehow?
- **Width strategy**: The list uses explicit px widths per field type (`WIDTH_BY_TYPE` in `use-custom-field-columns.ts`). The spreadsheet uses `min-w-36` (144px) uniformly. Should custom columns use a fixed width, `min-w-36`, or per-type widths?
- **Scope**: Are all six field types (text, number, date, single_select, multi_select, people) in scope, or a subset for the first pass?
- **Frozen-column interaction**: Should custom field columns participate in horizontal scroll normally (no freeze), same as built-in non-first columns? Confirmed behavior: only the first column is sticky.
- **Multi-project / workspace spreadsheet**: The workspace-level spreadsheet (`roots/workspace-root.tsx`) has `isWorkspaceLevel=true` and no `projectId`. Custom fields are project-scoped. Should custom columns be omitted for workspace-level views, or shown per-issue based on that issue's project?
- **Sort support**: The list's `CustomColumnHeaderCell` shows a plain label, not a sort menu. Should the spreadsheet custom field header also be non-sortable, or use a `HeaderColumn`-style sort menu?
- **`AddCustomFieldHeaderButton`**: Should the spreadsheet header expose the same "+ add field" affordance as the list? Or is that out of scope for this pass?

---

## Summary for the Planner

The spreadsheet layout is a self-contained `<table>` component whose column list is driven entirely by the hardcoded `SPREADSHEET_PROPERTY_LIST` constant (`packages/constants/src/issue/common.ts:213`), with cell renderers looked up from the static `SPREADSHEET_COLUMNS` map (`apps/web/ce/components/issues/issue-layouts/utils.tsx:97`). The list layout has a parallel but architecturally different mechanism — a MobX-observable runtime provider registry (`registerListColumnProvider` / `getCustomListColumns`, `list-columns.ts:138-153`) that `CustomFieldColumnsBridge` populates on mount; the spreadsheet has no equivalent. All the underlying data infrastructure (backend DRF viewsets, `WorkItemFieldStore`, `WorkItemFieldService`, `WorkItemFieldCell`) is proven and live, serving the list layout already. The work to add custom fields to the spreadsheet is entirely in the frontend rendering layer: (a) add a runtime column extension mechanism (or equivalent) to the spreadsheet path, (b) inject custom `<th>` header cells into `SpreadsheetHeader`, (c) inject custom `<td>` cells into `IssueRowDetails`, (d) mount field + value hydration (bridge or equivalent) from the spreadsheet view, and (e) create a `TSpreadsheetColumn`-compatible wrapper around `WorkItemFieldCell`. There are no backend changes required.
