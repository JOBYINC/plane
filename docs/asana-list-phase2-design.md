# Asana List View — Phase 2 Design Doc

**Status:** Draft (started 2026-05-15)
**Branch:** `feature/lark-oauth-provider` (continuation of the list-view line; PR1-3 already shipped)
**Sequencing:** Starts AFTER `feature/custom-fields` lands. See §6 conflict matrix for why.

Phase 1 (shipped 2026-05-15): aligned column grid + sticky header (PR1),
clickable header sort (PR2), multi-field inline quick-add (PR3).

Phase 2 = three more Asana-parity features the user asked for:

- **F1. Column drag-reorder** — drag a column header left/right to change order
- **F2. Column width resize** — drag a column border to widen/narrow
- **F3. Free-form Sections** — Asana-style organizational buckets, decoupled from workflow State

---

## 0. Current-state findings (audited 2026-05-15)

Plane CE has **zero infrastructure** for all three:

- No `Section` model, no `issue.section_id`. Sections-as-state is the only grouping today (`group_by` ∈ state/priority/labels/assignees/cycle/module/created_by/target_date/state_detail.group/project).
- No column-reorder anywhere (spreadsheet view can't reorder columns either).
- No column-width-resize anywhere.
- `IIssueDisplayProperties` is **booleans only** (visible/hidden per property) — no order, no width. Persisted server-side via the issue-filter store (`updateFilters` → `EIssueFilterType.DISPLAY_FILTERS` / display_properties).
- Phase-1 grid order/width come from static consts in
  `apps/web/core/components/issues/issue-layouts/list/columns/list-columns.ts`
  (`LIST_COLUMN_ORDER`, `LIST_COLUMN_WIDTHS`, `getListGridTemplate()`).
  **This single file is the integration point for F1 + F2.**

Everything here is greenfield.

---

## 1. Shared decision: where does per-column state persist?

F1 (order) and F2 (width) both need to persist a per-column value. So does
custom-fields (visibility of custom columns). One decision covers all three.

| Option                   | Scope                       | Cost                                                                                                                            | Asana-grade?                                          |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **A. Backend-persisted** | per user × project (× view) | new payload field through `IIssueDisplayProperties`-adjacent type + filter store + Django serializer/model + updateFilters flow | yes — survives reload, syncs across devices, per-user |
| **B. localStorage**      | per browser                 | frontend-only, ~1 day each                                                                                                      | no — not synced across devices/users                  |

**Recommendation: Option A, designed ONCE as a `view_columns` structure**, not three ad-hoc fields. Proposed shape (lives next to display_properties in the filter payload):

```ts
// New, persisted alongside displayProperties
type TViewColumnPrefs = {
  // Ordered list of column keys (built-in TListColumnKey OR custom field id).
  // Absent keys fall back to LIST_COLUMN_ORDER default position.
  order?: string[];
  // Pixel width override per column key. Absent = LIST_COLUMN_WIDTHS default.
  widths?: Record<string, number>;
};
```

Why one structure: custom-fields will already extend the column system with
runtime columns (its design doc §7 `registerListColumnProvider`). Order + width
must cover **built-in AND custom** columns uniformly, keyed by the same column
id space. Designing three separate persistence fields = three migrations +
three serializer touches + repeated merge pain. One `TViewColumnPrefs` keyed by
column id is the DRY model.

Backend: extend the project/view display-filters serializer with a JSONB
`view_column_prefs` (no per-column rows needed — small, read whole).

---

## 2. F1 — Column drag-reorder

**Interaction:** drag a header cell horizontally; drop reorders. Reuse
`@atlaskit/pragmatic-drag-and-drop` (already used for row drag in
`list/block.tsx` / `block-root.tsx`).

**Wiring:**

- `list-sort-header-cell.tsx` (PR2) becomes draggable + a drop target.
- Drop computes new order array → writes `view_column_prefs.order` via the
  same `handleDisplayFilterUpdate` channel PR2 already threads down.
- `getVisibleListColumns()` in `list-columns.ts` changes from "static
  `LIST_COLUMN_ORDER` filtered by displayProperties" to "merge(persisted
  order, default order) filtered by displayProperties + custom-field
  providers". The grid template (`getListGridTemplate`) consumes the merged
  order — header + every row already share it via the `--list-cols` CSS var,
  so rows realign for free.
- Title column is pinned first (non-draggable), like Asana's Task column.

**Estimate:** ~2 days frontend once §1 persistence exists.

---

## 3. F2 — Column width resize

**Interaction:** hover a column's right border → resize cursor → drag to set
width. Min-width clamp.

**Wiring:**

- A ~4px resize handle absolutely positioned on the right edge of each header
  cell. Pointer drag updates a live width; on pointer-up persist
  `view_column_prefs.widths[colKey]`.
- `getListGridTemplate()` already centralizes the template string — swap
  `LIST_COLUMN_WIDTHS[c]` for `widths[c] ?? LIST_COLUMN_WIDTHS[c]`. Header +
  rows realign automatically (shared CSS var).
- Title column stays `minmax(min, 1fr)` so it absorbs slack like Asana.
- Min width clamp (e.g. 80px).

**Estimate:** ~1.5 days frontend once §1 persistence exists.

F1 + F2 share the same persistence + the same `getListGridTemplate` seam, so
build them together (one PR) — splitting doubles the persistence plumbing.

---

## 4. F3 — Free-form Sections (the big one)

User intent: "States 限制太大，希望自由定义 section 替换掉 States."

Asana's model: a project has an **ordered list of Sections**; each task
belongs to **exactly one section**; a section is a pure organizational bucket
with **no workflow semantics**. Drag a task between sections = reorganize, not
"change status".

Plane's model: tasks have `state_id` (a workflow State with a `group`:
backlog/unstarted/started/completed/cancelled/triage). "Sections" today are
just the render of `group_by = state`. There is no section entity.

### 4.1 The load-bearing-State problem (OPEN DECISION — do not assume)

State is **not** just a UI grouping in this fork. It is wired into:

- **Automation Engine** (this fork's feature): triggers on `state_changed`,
  rules move issues between state groups, due-soon logic keys off
  `state.group`. See [[automation-engine-loop-guard]].
- **Completion semantics**: `group = completed` marks issues done; analytics,
  "Your Work" all read state groups.
- Default pre-installed automation rules reference `state_group`.

So **"replace States entirely" is high-risk and large** — it would gut the
Automation Engine and completion model. Three viable strategies, user must pick:

| Strategy                                          | What it means                                                                                                                                                                                                                                                  | Cost         | Risk                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| **S1. Sections coexist with State** (recommended) | New independent `ProjectSection` entity + `issue.section_id`. New `group_by = "section"` mode. State still exists underneath (can be de-emphasized / collapsed to one hidden field in UI). Day-to-day org by sections; automation/completion keep using state. | Medium-large | Low — additive, nothing ripped out                                             |
| **S2. Sections backed by State**                  | "Sections" are a renamed, freely-creatable State list with `group` forced neutral. Reuses state plumbing.                                                                                                                                                      | Small-medium | Medium — State.group constraints leak; automation may misfire on neutral group |
| **S3. Replace State with Sections**               | Rip out State, migrate automation/completion onto Sections.                                                                                                                                                                                                    | Very large   | High — guts Automation Engine + completion; long migration                     |

**Recommendation: S1.** It gives true free-form sections (create / rename /
reorder / drag-between) WITHOUT destabilizing the Automation Engine or
completion. State becomes optional/secondary. If the user later wants State
fully gone, S1 is a stepping stone to S3, not a dead end.

### 4.2 S1 data model (sketch — finalize at kickoff)

```python
class ProjectSection(ProjectBaseModel):
    name = models.CharField(max_length=255)
    sort_order = models.FloatField(default=65535.0)
    is_collapsed_default = models.BooleanField(default=False)
    class Meta:
        unique_together = [["project", "name"]]
        ordering = ["sort_order"]

# Issue gets:
#   section = models.ForeignKey(ProjectSection, null=True,
#                               related_name="issues", on_delete=SET_NULL)
```

- New `group_by = "section"` in `TIssueGroupByOptions` + the group-by
  resolver (`issue-layouts/utils.tsx getGroupByColumns`).
- `list-group.tsx` already renders collapsible groups + drag-between-groups; a
  "section" group_by reuses it. Drop handler writes `section_id` instead of
  `state_id` (drop-order math in `utils.tsx:461-488` is group-agnostic — only
  the written field changes).
- Section CRUD UI: add / rename / reorder / delete (like Asana "Add section");
  per-section inline-add already exists from PR3 quick-add (prePopulate
  `section_id`).
- Default "(No section)" bucket for unassigned issues.

**Estimate:** model+migration+API ~3d, group-by + drag wiring ~3d, section
CRUD UI ~3d, polish ~2d ≈ **~11 days** — heaviest Phase-2 item, comparable to
custom-fields.

---

## 5. Recommended sequencing

1. **custom-fields** (separate branch, scaffolded) — lands first; builds the
   runtime column registry (`registerListColumnProvider`) F1/F2 need so custom
   columns are also reorderable/resizable.
2. **§1 persistence (`TViewColumnPrefs`)** — one backend+store change,
   unblocks F1+F2.
3. **F1 + F2 together** (one PR; shared seam in `list-columns.ts` +
   `getListGridTemplate`).
4. **F3 Sections** — largest; independent of F1/F2, can run in parallel with
   steps 2-3 if a second person is free (different files: backend section
   model + group-by vs frontend column prefs).

---

## 6. Conflict matrix — does custom-fields collide with these / current features?

User's explicit question: 模块上是否冲突。

| Pair                                      | Overlap                                                                                                                                                                                                   | Verdict                                                                                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **custom-fields ↔ shipped PR1-3**         | custom-fields forked from the lark branch AFTER PR1-3; its design doc §7 maps coordination files (`list-columns.ts`, `view-props.ts`, `common.ts`, i18n)                                                  | **No conflict.** PR1-3 are the base; custom-fields adds the column-provider plugin on top. Rebase-before-merge as documented.                                                                                         |
| **custom-fields ↔ F1/F2 (reorder/width)** | BOTH touch `list/columns/list-columns.ts` (registry + order/width source) AND the display-prefs persistence surface                                                                                       | **Real overlap — intentional ordering.** F1/F2 MUST follow custom-fields so order/width cover built-in **and** custom columns through one registry. This is exactly why "等 custom 完成后再进行" is the correct call. |
| **custom-fields ↔ F3 Sections**           | custom-fields = field schema/values (new `WorkItemField*` models, peek panel, filter/sort). Sections = grouping + new `ProjectSection` model + group-by. Different backend models, different UI surfaces. | **Mostly independent.** Only abstract touchpoint: a `select` custom field could _also_ serve as a grouping dimension someday — optional future, not a conflict. Build in parallel or any order.                       |
| **custom-fields ↔ Automation Engine**     | custom-fields adds fields; automation triggers on state/assignee/priority. v1 custom-fields are NOT automation triggers (its design doc §1 out-of-scope)                                                  | **No conflict v1.** "Trigger on custom field change" later = additive engine extension.                                                                                                                               |
| **F3 Sections ↔ Automation Engine**       | S1 keeps State → automation keeps firing on State. S3 (replace State) would gut automation.                                                                                                               | **No conflict under S1/S2. S3 conflicts hard** — another reason S1 is recommended.                                                                                                                                    |

**Bottom line for the user:** custom-fields does **not** conflict with the
shipped list view or with Sections. It **does** share files with the future
column reorder/width work — which is precisely why those are sequenced _after_
it. It's sequencing, not conflict.

---

## 7. Open questions to resolve at Phase-2 kickoff

- **F3 strategy: S1 / S2 / S3?** (Recommend S1.) Single biggest decision; gates the whole Sections workstream.
- Persistence scope: per-project, or per-view (Plane has saved Views — per-view column prefs is more powerful but more storage/UI)?
- Do Sections and State both show in the group-by menu, or does choosing Sections hide State grouping?
- Column width: pixel widths, or fractional/flex weights (Asana uses pixel)?
- Should the Task/title column be user-movable at all? (Asana pins it leftmost — recommend pin.)

Related: [[asana-list-rebuild-plan]] (Phase 1, done), [[custom-fields-branch]] (must land before F1/F2).
