# Free-form Sections — Design Doc (Strategy S1)

**Status:** Draft (started 2026-05-15)
**Branch:** `feature/asana-sections` (worktree `joby-plane-fork-sections/`, forked from `feature/lark-oauth-provider` @ `8994682030`)
**Runs in parallel with:** `feature/custom-fields` (independent — see §8)
**Strategy:** **S1 locked** (Sections coexist with State; State stays for workflow/automation).

Parent analysis (S1/S2/S3 tradeoff, conflict matrix) lives in
`docs/asana-list-phase2-design.md` §4 on the lark branch.

---

## 1. Goal

Asana-style **Sections**: a project has an ordered list of named buckets; each
work item belongs to **exactly one** section (or none); a section is a pure
organizational container with **no workflow semantics**. Drag a task between
sections = reorganize, not "change status".

State (`state_id`, `group` ∈ backlog/unstarted/started/completed/cancelled/
triage) **stays untouched** — remains the workflow axis the Automation Engine
and completion model depend on. Sections are a parallel, independent axis.

In-scope (v1):

- `ProjectSection` entity (create / rename / reorder / archive)
- `issue.section_id` (nullable; null = "(No section)" bucket)
- New `group_by = "section"` list-view mode (reuses existing collapsible-group
  - drag-between-group machinery from PR1-3)
- Per-section inline quick-add (prePopulate `section_id` — PR3 already supports
  prePopulated group values)
- Section CRUD UI ("Add section", inline rename, drag reorder, archive)

Out of scope (v1):

- Removing/replacing State (that is S3, explicitly not this)
- Sections on kanban/spreadsheet/calendar/gantt (list view only v1)
- Section-level permissions
- Cross-project / workspace sections
- Section templates

---

## 2. The hard constraint (non-negotiable, user-agreed 2026-05-15)

S1's value is that it keeps a **clean, incremental path to eventually remove
State** if the team later wants it. That path stays clean only if we do NOT
deepen State entanglement while building Sections. Two rules:

1. **No new code may read `state.group` for organization/grouping/display.**
   Sections never look at State. Grouping by section is by `section_id` only.
2. **Completion stays behind one abstraction.** Today "is this issue done?" is
   `state.group === "completed"` read in many places. Do NOT add new direct
   reads. If Sections code ever needs "is this done", it goes through a single
   helper (`isIssueComplete(issue)` — reuse if one exists, else introduce one)
   so a future State removal swaps one function, not N call sites.

Violating these turns S1 into "State everywhere + Sections bolted on" — no
cleaner to unwind than today. Reviewer must enforce in every PR.

---

## 3. Data model

New Django model in `apps/api/plane/db/models/`. Named `ProjectSection` to
avoid `Section` collisions.

```python
class ProjectSection(ProjectBaseModel):
    """An ordered, free-form organizational bucket within a project.
    No workflow semantics — purely how the user groups work items."""
    name = models.CharField(max_length=255)
    sort_order = models.FloatField(default=65535.0)
    is_collapsed_default = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)

    class Meta:
        unique_together = [["project", "name"]]
        ordering = ["sort_order"]
        indexes = [
            models.Index(fields=["project", "is_archived", "sort_order"]),
        ]
```

Issue gains:

```python
# on Issue model
section = models.ForeignKey(
    "db.ProjectSection",
    null=True, blank=True,
    related_name="issues",
    on_delete=models.SET_NULL,
)
```

`SET_NULL` (not CASCADE): deleting a section must NEVER delete work items —
they fall back to "(No section)". Issues keep their `state_id` intact
(independent axis — the whole point of S1).

No backfill. Existing issues have `section_id = NULL` → render under
"(No section)" until the user organizes them.

---

## 4. Migration numbering — the ONE coordination point with custom-fields

Both branches forked when `0122_automationrule_automationrulerun` was latest.

- `feature/custom-fields` will create **`0123_workitemfield...`** (its §4).
- This branch creates **`0124_projectsection_issue_section`** with
  `dependencies = [("db", "0122_automationrule_automationrulerun")]`
  (NOT 0123 — it does not exist on this branch).

On merge, Django sees two migrations depending on `0122` (custom-fields 0123,
sections 0124) → two leaf nodes. Resolution rule:

> **Whichever branch merges to mainline SECOND** rebases its migration's
> `dependencies` onto the other branch's migration (or runs
> `python manage.py makemigrations --merge`). Record the chosen leaf in the
> merge PR. Never renumber a migration already applied on a running env.

Name the file explicitly — do NOT let `makemigrations` auto-number it to 0123
(silent collision with custom-fields).

---

## 5. REST API

Base prefix: `/api/v1/workspaces/<slug>/projects/<project_id>/`

| Method | Path                         | Body / Returns                                                                     |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `sections/`                  | `ProjectSection[]` (active, ordered)                                               |
| POST   | `sections/`                  | create (name; sort_order auto-append)                                              |
| PATCH  | `sections/<id>/`             | rename / reorder (sort_order) / collapse default                                   |
| DELETE | `sections/<id>/`             | archive (is_archived=True) — soft; issues keep section_id, just hidden from picker |
| PUT    | `issues/<issue_id>/section/` | set/clear `section_id` (body `{ section_id: uuid \| null }`)                       |

Reorder: float `sort_order` between neighbors (same trick used elsewhere in
Plane). Single PATCH per move v1; bulk endpoint optional later.

Issue list serializer: add `section_id` to the issue payload (same pattern as
`state_id`) so grouping needs no extra fetch.

Permissions: project admin/member CRUD sections; member moves issues between
sections. No per-section grants v1.

---

## 6. Frontend wiring

### 6.1 group_by = "section"

- Extend `TIssueGroupByOptions` (`packages/types/src/view-props.ts:14`) with
  `"section"`. Append-only — custom-fields and shipped PR2 don't touch this
  union. Low collision.
- `issue-layouts/utils.tsx` `getGroupByColumns()` — add a `section` branch:
  one column per active `ProjectSection` (+ synthetic "(No section)" for
  `section_id == null`), ordered by `sort_order`.
- `list-group.tsx` already does collapsible groups, sticky group headers (PR1
  set `lg:top-9`), drag-between-groups, per-group quick-add. `section`
  group_by reuses ALL of it. Only new behavior: drop handler writes
  `section_id` instead of `state_id`.
- Drop math: the sort-order helpers in `issue-layouts/utils.tsx` (~461-488)
  are group-field-agnostic — they compute a new `sort_order`; only the patch
  that identifies the destination group changes. Add a `section` case wherever
  destination-group → issue-patch mapping lives (today maps state/priority/…
  → `{state_id}`/`{priority}`/…).

### 6.2 Section CRUD UI

- Section group header: inline-editable name + "⋯" menu (rename / archive /
  reorder).
- "Add section" affordance at list bottom (Asana places it after sections);
  optimistic insert.
- Reorder: drag the section header — new dnd type `"SECTION"`, distinct from
  existing `"ISSUE"` / `"COLUMN"` types so row-drag and section-drag don't
  interfere.

### 6.3 MobX store

`apps/web/core/store/project/project-section.store.ts`:

```ts
type TProjectSection = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  is_collapsed_default: boolean;
  is_archived: boolean;
};

class ProjectSectionStore {
  sectionsByProject: Map<string, TProjectSection[]>;
  getSections(projectId: string): TProjectSection[];   // active, ordered
  createSection / renameSection / reorderSection / archiveSection
  setIssueSection(issueId: string, sectionId: string | null): Promise<void>;
}
```

Wire into RootStore beside project state/label stores.

---

## 7. Sequencing (≈ one commit per step)

1. **Model + migration** (`0124_*`, backend only) — enforce §4
2. **Serializers + section CRUD viewset** + add `section_id` to issue serializer
3. **`PUT issues/<id>/section/`** endpoint
4. **MobX `ProjectSectionStore`**
5. **`group_by = "section"`**: type append + `getGroupByColumns` + drop-handler
   field mapping (reuses list-group render — no new list UI yet)
6. **Section CRUD UI** (inline rename, add-section, archive)
7. **Section reorder drag** (`type: "SECTION"` dnd)
8. Polish: collapse-default, empty "(No section)", i18n (en + zh-CN)

Steps 1-5 = backend + store + one type/util change → **zero overlap with
custom-fields**.

---

## 8. Why this is safely parallel with custom-fields

| Surface                        | custom-fields                                  | sections                                     | Collision                   |
| ------------------------------ | ---------------------------------------------- | -------------------------------------------- | --------------------------- |
| Backend models                 | `WorkItemField*`                               | `ProjectSection` + `Issue.section_id`        | none                        |
| Django migration               | `0123`                                         | `0124` (dep 0122)                            | **coordinated §4**          |
| `list/columns/list-columns.ts` | rewrites `getVisibleListColumns` + plugin hook | does NOT touch                               | none                        |
| `list-group.tsx`               | does NOT touch                                 | reuses (drop field map)                      | none                        |
| `view-props.ts`                | maybe orderBy keys                             | append `"section"` to `TIssueGroupByOptions` | low (different lines)       |
| Issue serializer               | `field_values` expand                          | `section_id` field                           | low (append-only same file) |
| group-by / drag                | does NOT touch                                 | core surface                                 | none                        |

Only true coordination: (a) migration numbering §4, (b) a one-line
`TIssueGroupByOptions` append + issue-serializer field — both append-only,
resolved by rebase-before-merge. **No shared function is rewritten by both**
(contrast custom-fields ↔ F1/F2, which DO both rewrite `getVisibleListColumns`
and therefore must be sequential, not parallel).

---

## 9. Deployment

GHCR workflow currently triggers only `feature/lark-oauth-provider` +
`feature/custom-fields`. Steps 1-5 are backend/store, verified via Django
migrations + local dev — **CI image build NOT needed early**. Defer wiring
this branch into `.github/workflows/build-lark-feature.yml` until step 6+ has
frontend worth previewing; then add `feature/asana-sections` to the trigger
list (tag fallback already yields `lark-feature-asana-sections`; staging stays
on `lark-stable`).

---

## 10. Open questions (resolve as we go, not blocking step 1)

- Archived section: keep its issues' `section_id` (hidden from picker, can
  un-archive) or null them? Recommend keep (reversible).
- Is `group_by = "section"` the default for new projects, or opt-in? (Asana
  defaults to sections.)
- "(No section)" bucket: always shown or only when non-empty?
- Saved Views: does a View persist its own section grouping? Defer — follow
  whatever Views already do for group_by.
- Reorder: single PATCH per move (start here) vs bulk endpoint.

## 11. Resolution log (steps 1–8 implemented 2026-05-15)

Steps 1–8 of §7 are implemented and committed on `feature/asana-sections`
(one commit per step). Resolutions to §10 / notes for follow-up:

- **Archived section** — keeps issues' `section_id` (reversible). DELETE
  soft-archives (`is_archived=True`); issues fall back to "(No section)"
  in the picker/grouping but retain their id. (§5 implemented as designed.)
- **"(No section)" bucket** — RESOLVED: always emitted by
  `getSectionColumns`, but the existing list `validateEmptyIssueGroups` /
  `showEmptyGroup` machinery already hides any empty group (including this
  one) unless "show empty groups" is on. No extra code; behaviour matches
  the rest of the list. Label kept hard-coded `"(No section)"` to stay
  consistent with sibling synthetic columns (`getCycleColumns` /
  `getModuleColumns` hard-code `"None"`; those are non-React store
  functions with no `useTranslation`).
- **`is_collapsed_default`** — DEFERRED (data layer complete, UI honoring
  is a scoped follow-up). The field is fully plumbed end-to-end
  (model → 0124 migration → serializer → store → `TProjectSection`), but
  list-view collapse state derives from the persisted, **cross-view
  (kanban+list), cross-group-type** `kanbanFilters.group_by` set in
  `base-list-root`. Seeding section defaults into that shared persisted
  state cleanly (default applies only until the user toggles; "never set"
  vs "user expanded" needs extra state) is regression-prone and out of
  proportion to a polish step. Follow-up: honor `is_collapsed_default` on
  first render without polluting persisted user filter state.
- **group-by selector i18n** — reuses the pre-existing `common.sections`
  key; new component strings use `common.{rename,add_section,
section_name,section_archived,section_update_failed}` (en + zh-CN added).
- **Drag affordance / drop precision** (step 7) — v1 confines the SECTION
  drag to the header actions area and always inserts before the target
  (no above/below hitbox split); no reorder relative to synthetic
  "(No section)". Functional but needs **manual browser QA** (dnd is not
  verifiable headless; CI image build deferred per §9).
- **Not yet done (out of original §7 scope, future)**: `group_by=section`
  as new-project default vs opt-in (§10); Saved-View section grouping
  persistence (§10 — follow Views' existing group_by behaviour); bulk
  reorder endpoint (§10 — single PATCH per move shipped).

Verification status: backend migration/`makemigrations --check` and full
`tsc` were NOT run here (no local Django/venv; Plane dev is Docker).
Per-file `oxlint --deny-warnings` is clean for all new code; pre-existing
upstream lint/a11y/enum debt in forced-touch files is handled with scoped
`oxlint-disable` headers (user-approved). Run Django `makemigrations
db --check` + `migrate`, `tsc`, and manual browser QA of group-by=section
(grouping, quick-add, issue drag between sections, section CRUD, section
reorder drag) in the Docker dev env before merge.

Related: `docs/asana-list-phase2-design.md` §4 (S1/S2/S3),
[[custom-fields-branch]] (parallel branch), [[automation-engine-loop-guard]]
(why State must stay under S1).
