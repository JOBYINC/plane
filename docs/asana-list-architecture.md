# Asana List Architecture Decision

**Date:** 2026-05-17
**Branch context:** `feature/custom-fields-spreadsheet` = HEAD = production line @ `97e0d34620`
**Goal:** Deliver the Asana List experience — section-grouped spreadsheet-style table with per-column resize, column drag-reorder, row drag (including between sections), and custom-field columns.

---

## Capability Matrix

| Capability                                    | List layout (HEAD `97e0d34620`)                                                                                                                                                                                                                                                                  | Spreadsheet layout (HEAD)                                  | `origin/feature/asana-sections` (`5a53ab197e`)                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section grouping (group_by=section)**       | No — `section` not in `ISSUE_GROUP_BY_KEY` on HEAD; `utils.tsx` has no `getSectionColumns`                                                                                                                                                                                                       | No — no group-by at all; flat `issueIds[]` only            | YES — full S1 implementation: `ProjectSection` model, `group_by="section"`, `getSectionColumns`, `SectionGroupActions`, `AddSectionRow`, `validateEmptyIssueGroups` fix, server-side grouper (`apps/api/plane/utils/grouper.py:111`)                                        |
| **Per-column width resize (F2)**              | No — static `LIST_COLUMN_WIDTHS` map, no resize handle, no `TViewColumnPrefs`                                                                                                                                                                                                                    | No — `min-w-36` Tailwind only                              | No — not in either branch                                                                                                                                                                                                                                                   |
| **Column drag-reorder (F1)**                  | No — `LIST_COLUMN_ORDER` is hardcoded; `@atlaskit` used only for row/group drag                                                                                                                                                                                                                  | No — column order is hardcoded `SPREADSHEET_PROPERTY_LIST` | No — not in either branch                                                                                                                                                                                                                                                   |
| **Custom-field columns**                      | YES — full implementation: `registerListColumnProvider`, `CustomFieldColumnsBridge`, `getCustomListColumns()`, `getListGridTemplateWithCustom()`, `WorkItemFieldCell`, `CustomColumnHeaderCell` (`list-columns.ts:119-185`, `default.tsx:111`, `block.tsx:357-373`, `list-header-row.tsx:65-67`) | No — 8 gaps documented in `spreadsheet-recon.md §6`        | No — design doc only (`c9519ea9dd`), no implementation                                                                                                                                                                                                                      |
| **Row drag (reorder within group)**           | YES — `@atlaskit/pragmatic-drag-and-drop` in `block.tsx:9-10` + `blocks-list.tsx:114-127`                                                                                                                                                                                                        | No — no drag handlers anywhere in spreadsheet tree         | YES — same mechanism; `canDrag` flows through `blocks-list.tsx`                                                                                                                                                                                                             |
| **Row drag (move between groups / sections)** | YES for `DRAG_ALLOWED_GROUPS` (`state`, `priority`, `assignees`, `labels`, `module`, `cycle`), not `section` on HEAD                                                                                                                                                                             | No                                                         | `section` is NOT in `DRAG_ALLOWED_GROUPS` on asana-sections (`packages/constants/src/issue/common.ts`); drop machinery uses `ISSUE_GROUP_BY_KEY[section]="section_id"` + dedicated `PUT .../issues/{id}/section/` endpoint wired in `ProjectSectionService.setIssueSection` |

**Note on sections row drag:** `asana-sections` list-group `isDragAllowed` reads `DRAG_ALLOWED_GROUPS.includes(group_by)` — `"section"` is absent from that array on that branch. Empty-group visibility is forced via `if (group_by === "section") return true` (`list-group.tsx:151`), but cross-section issue move needs `"section"` added to `DRAG_ALLOWED_GROUPS`. The dedicated `PUT /issues/{id}/section/` endpoint exists and the `ISSUE_GROUP_BY_KEY` mapping is wired; only the constant gating `isDragAllowed` is missing (one-line fix).

---

## Branch Reality

| Branch                                                 | Tip          | Merge base with HEAD                                                | Contains                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/custom-fields-spreadsheet` (HEAD / prod line) | `97e0d34620` | —                                                                   | Custom-field columns in List (complete), Lark fixes, CI fixes. No Sections, no F1/F2. Migration `0124_workitemfield` depends on `0123_larkduereminderlog`.                                                                                                    |
| `origin/feature/asana-sections`                        | `5a53ab197e` | `8994682030` (shared ancestor 13 commits before asana-sections tip) | Free-form Sections (complete S1): model, migration, CRUD, group-by, drag reorder of sections, `group_by=section` in List. No custom-field columns (design doc only). No F1/F2. Migration `0124_projectsection` depends on `0122_automationrule` (NOT `0123`). |
| `origin/preview`                                       | `16f90a1f5a` | `8994682030` (same as above)                                        | Same as HEAD; is the merge target that HEAD was built from.                                                                                                                                                                                                   |

**Divergence:** HEAD has ~15 commits (custom-fields + Lark fixes) that `asana-sections` does not. `asana-sections` has ~13 commits (Sections) that HEAD does not. Both branched from `8994682030` and diverged independently. No commit from either is in both; a merge or rebase is required.

**Migration collision:** Both branches define a migration numbered `0124`. HEAD's is `0124_workitemfield` (deps: `0123`). asana-sections's is `0124_projectsection` (deps: `0122`). On merge, the second-to-merge must be renumbered to `0125` and its deps updated. The sections design doc (`0124_projectsection_issue_section.py:11-14`) explicitly documented this coordination step.

---

## Option A — Build on the List Layout

**Foundation:** The List layout already has custom-field columns (complete), row drag, group-by infrastructure, and a CSS Grid with explicit per-column widths. `asana-sections` adds Sections to this same layout.

### What exists

- Custom-field columns: fully shipped (HEAD)
- Row drag within groups: `@atlaskit` in `block.tsx`, `blocks-list.tsx`
- Group-by infrastructure: `getGroupByColumns` dispatch in `utils.tsx`, `list-group.tsx` drop handling
- CSS Grid + `--list-cols` var: single seam (`getListGridTemplateWithCustom` in `list-columns.ts:177`) for F2

### What's missing

1. **Sections (F3):** Entire `asana-sections` branch must be merged into HEAD. Frontend-only files: 9 list layout files + `utils.tsx` + 4 store/service/hook files. Backend: `ProjectSection` model, migration `0124_projectsection`, CRUD viewset, section endpoint, grouper update.
2. **Cross-section row drag:** Add `"section"` to `DRAG_ALLOWED_GROUPS` (`packages/constants/src/issue/common.ts:93`) — one-line change.
3. **F1 column drag-reorder:** New `@atlaskit`-draggable header cells in `list-sort-header-cell.tsx`, `TViewColumnPrefs` persistence (`view_column_prefs` JSONB), update `getVisibleListColumns` to read persisted order. Phase2 design §2 fully specifies this.
4. **F2 column width resize:** Resize handle on header cells, persist `view_column_prefs.widths`, swap `LIST_COLUMN_WIDTHS[c]` with `widths[c] ?? LIST_COLUMN_WIDTHS[c]` in `getListGridTemplateWithCustom`. Phase2 design §3 fully specifies this.
5. **`TViewColumnPrefs` backend:** One new JSONB field on the display-filters Django serializer + model.

### Integration / merge cost

- Merge `asana-sections` into HEAD (or rebase). Files that touch the same modules: `list-columns.ts` (HEAD added custom column registry; asana-sections kept the old 109-line version without it — **real merge conflict in this one file**), `block.tsx`, `list-header-row.tsx`, `default.tsx`, `utils.tsx`. All other Sections files are additive (new files).
- Renumber sections migration to `0125`, set deps to `0124_workitemfield`.
- One `DRAG_ALLOWED_GROUPS` line for cross-section drag.
- F1 + F2 are then new work on top, but they share the same seam (`getListGridTemplateWithCustom`, the `--list-cols` CSS var) that custom-fields already extended. Both built-in AND custom columns are already in that template function — F1/F2 naturally extend it.

---

## Option B — Build on the Spreadsheet Layout

**Foundation:** Flat `<table>` with `min-w-36` columns, no group-by, no drag, no custom fields.

### What exists

- Horizontal scroll + frozen first column (CSS sticky, JS shadow)
- Built-in column cells (`SPREADSHEET_COLUMNS` static map)

### What's missing

1. **Custom-field columns:** All 8 gaps from `spreadsheet-recon.md §6` — runtime column registry, header injection, row cell injection, bridge mount, cell adapter for `WorkItemFieldCell`. ~3 days.
2. **Group-by / Sections (F3):** The spreadsheet has NO group-by infrastructure. Would need to wrap the flat `issueIds[]` table in section containers — structural redesign of `spreadsheet-view.tsx` + `spreadsheet-table.tsx`. The List's `list-group.tsx` drop machinery does NOT apply here; it's layout-specific. Section-grouped spreadsheet = substantially new component. ~5-7 days.
3. **Row drag:** No drag at all in spreadsheet tree. Must add `@atlaskit` from scratch to `issue-row.tsx` + a new drop target system. ~2 days.
4. **F1 column drag-reorder:** The spreadsheet has no CSS Grid, no `--list-cols` var, no `TListColumnKey` system. The phase2 design §1-2 is written entirely for the List layout's seam (`list-columns.ts`). Porting F1 to the spreadsheet means designing a parallel system. ~3 days + new persistence design.
5. **F2 column width resize:** Same issue — no width map, no CSS Grid. Each `<td>` is `min-w-36`. Would need to add a JS width map + either switch to CSS Grid or manage widths via inline styles. ~2 days.
6. **`TViewColumnPrefs` backend:** Same as Option A.

### Reusable from spreadsheet

- `WorkItemFieldCell` (shared, layout-independent)
- `WorkItemFieldStore` / `registerListColumnProvider` concept (but would need a new "spreadsheet column provider" variant)
- The frozen-first-column CSS sticky pattern is already solved; List would need to add it if a spreadsheet-feel is desired

---

## Comparison Summary

| Dimension               | Option A (List)                                                | Option B (Spreadsheet)                                     |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Custom fields           | **Done**                                                       | ~3 days                                                    |
| Sections (F3)           | **Done** (merge asana-sections)                                | ~5-7 days new structural work                              |
| Row drag                | **Done**                                                       | ~2 days                                                    |
| Cross-section row drag  | **1-line fix**                                                 | ~2 days                                                    |
| F2 column resize        | ~1.5 days (phase2 seam exists)                                 | ~2 days (no seam exists)                                   |
| F1 column reorder       | ~2 days (phase2 seam exists)                                   | ~3 days (new system needed)                                |
| Branch merge cost       | 1 merge + 1 conflict in `list-columns.ts` + migration renumber | No merge needed, but all capabilities rebuilt from scratch |
| Phase2 design alignment | All of phase2 is written for the List layout                   | Phase2 design has no spreadsheet target                    |

---

## Recommendation

**Build on Option A — the List layout.**

The List layout already has two of the five required capabilities (custom fields, row drag), and the Sections capability exists complete and tested on `asana-sections` waiting for a single merge. The only real integration cost is a merge with one file conflict (`list-columns.ts`) and a migration renumber. Option B requires rebuilding every capability from scratch against a layout that has no group-by infrastructure, no drag, and no column width system — and doing so outside the phase2 design's stated target.

**Single biggest reason:** The phase2 design (`asana-list-phase2-design.md`) was explicitly written for the List layout. The F1/F2 seam (`list-columns.ts` + `getListGridTemplateWithCustom` + `--list-cols` CSS var) already handles both built-in and custom columns uniformly. Porting that to the spreadsheet's `<table>` + `min-w-36` architecture is not a port — it is a redesign.

**Single biggest risk:** The merge of `asana-sections` into HEAD must reconcile `list-columns.ts`. HEAD's version is 185 lines with the full custom column registry (`registerListColumnProvider`, `getCustomListColumns`, `getListGridTemplateWithCustom`). The asana-sections version is the original 109-line file without any of that. A careless merge would silently drop the custom column registry. The merge must be done with explicit intent: keep HEAD's column registry intact and layer in asana-sections' `getSectionColumns` / `validateEmptyIssueGroups` changes from `utils.tsx` and `list-group.tsx`.

---

## Required Branch-Reconciliation Steps

1. **Merge `origin/feature/asana-sections` into HEAD** (or rebase HEAD onto asana-sections — either direction works; merge is safer given HEAD is deployed prod).
   - Conflict files to resolve manually: `list-columns.ts` (keep HEAD's custom registry; no sections-specific changes in this file on asana-sections), `utils.tsx` (add `getSectionColumns` from asana-sections), `list-group.tsx` (add `if (group_by === "section") return true` and `section_id` quick-add from asana-sections), `list-header-row.tsx` (add `SectionGroupActions`), `default.tsx` (add `AddSectionRow`), `block.tsx` (check for any section-specific changes on asana-sections — appears none from the diff).
   - Additive (no conflict expected): all new files under `store/project/project-section.store.ts`, `services/project/project-section.service.ts`, `hooks/store/use-project-section.ts`, `list/headers/section-group-actions.tsx`, `list/add-section-row.tsx`, all backend section files.

2. **Renumber sections migration:** Rename `0124_projectsection_issue_section.py` → `0125_projectsection_issue_section.py` and update its `dependencies` to `[("db", "0124_workitemfield_workitemfieldoption_workitemfieldvalue")]`.

3. **Add `"section"` to `DRAG_ALLOWED_GROUPS`** (`packages/constants/src/issue/common.ts:93`) to enable row drag between sections. The drop payload and `ISSUE_GROUP_BY_KEY` mapping are already wired on asana-sections.

4. **F1 + F2 (new work):** Implement per phase2 design §2-3 on top of the merged branch. Integration point is `getListGridTemplateWithCustom` in `list-columns.ts` and the `--list-cols` CSS var in `default.tsx:170`. Persistence (`TViewColumnPrefs`) needs one new JSONB field on the Django display-filters serializer.

5. **Verify tsc and tests** after merge: `list-columns.ts` has MobX `observable` + `runInAction` imports; asana-sections' version does not — ensure imports survive the merge.
