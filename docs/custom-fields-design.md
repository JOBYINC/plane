# Custom Fields — Design Doc

**Status:** Draft (started 2026-05-15)
**Branch:** `feature/custom-fields` (forked from `feature/lark-oauth-provider` @ `f3ddb5f8db`)
**Shared with:** `feature/lark-oauth-provider` (list-view PR2/PR3 in parallel)

This document is the contract both branches code against. Touch it (via PR) if
the contract changes; do not silently drift.

---

## 1. Goal

Project-scoped user-defined fields (a.k.a. custom fields, properties) attached
to work items. Each project can declare any number of fields. A field has a
type (text, number, date, select, ...) and may be required or optional.

In-scope (v1):

- Per-project field schema (no workspace-wide fields, no per-work-item-type fields)
- 6 field types (Asana parity, no boolean): `text` / `number` / `date` / `single_select` / `multi_select` / `people`
- Rendering in list-view column, peek detail panel, kanban card (label only)
- Filter + sort by single_select / number / date
- Field reordering (admin UI)
- Soft delete (archive)

Out of scope (v1, push to v2 if asked):

- Formula / computed fields
- Cross-issue relation fields
- URL / file / rich-text types
- Per-work-item-type field whitelists
- Workspace-wide global fields
- Field-level RBAC (everyone in project can read/write)

---

## 2. Data model

Three new Django models in `apps/api/plane/db/models/`. **Naming intentionally avoids `IssueProperty`** — the original `IssueProperty` was renamed to `IssueUserProperty` in migration 0071 and is now project-user view preferences (collapsed columns etc.), not a schema.

> **Soft-delete & uniqueness (decided 2026-05-15, step 1).** Every model
> below inherits `SoftDeleteModel` (a nullable `deleted_at`) via
> `ProjectBaseModel`. A plain `unique_together = [["project","name"]]` would
> make a deleted field's name un-reusable forever (the row physically stays;
> `.delete()` only sets `deleted_at`) → `IntegrityError` on recreate. So each
> natural key uses the Plane house-style **dual pattern**: `unique_together`
> with `deleted_at` appended **plus** a partial
> `UniqueConstraint(condition=Q(deleted_at__isnull=True))`. This matches
> Module/State/ProjectIssueType upstream and Asana (a deleted field's name is
> not reserved). `is_active` (archive) is deliberately _not_ in the key — an
> archived-but-not-deleted field still reserves its name.

### `WorkItemField`

```python
class WorkItemField(ProjectBaseModel):
    """Schema definition of one custom field on a project."""

    class FieldType(models.TextChoices):
        TEXT = "text", "Text"
        NUMBER = "number", "Number"
        DATE = "date", "Date"
        SINGLE_SELECT = "single_select", "Single select"
        MULTI_SELECT = "multi_select", "Multi-select"
        PEOPLE = "people", "People"

    name = models.CharField(max_length=255)
    field_type = models.CharField(max_length=32, choices=FieldType.choices)
    sort_order = models.FloatField(default=65535.0)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True, default="")
    # Per-type config (e.g. number formatting, date format). JSONB for flexibility.
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        unique_together = [["project", "name", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_unique_project_name_when_deleted_at_null",
            )
        ]
        ordering = ["sort_order"]
        indexes = [
            models.Index(fields=["project", "is_active", "sort_order"]),
        ]
```

### `WorkItemFieldOption`

Only used by `single_select` / `multi_select` field types.

```python
class WorkItemFieldOption(ProjectBaseModel):
    field = models.ForeignKey(WorkItemField, related_name="options", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=16, default="#6B7280")
    sort_order = models.FloatField(default=65535.0)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [["field", "name", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["field", "name"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_option_unique_field_name_when_deleted_at_null",
            )
        ]
        ordering = ["sort_order"]
```

### `WorkItemFieldValue`

Per-issue value for one field. Sparse — only rows that have a value exist.

```python
class WorkItemFieldValue(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", related_name="field_values", on_delete=models.CASCADE)
    field = models.ForeignKey(WorkItemField, related_name="values", on_delete=models.CASCADE)
    # Polymorphic value storage. Exactly one of these is non-null per row,
    # determined by field.field_type. value_text covers single_select
    # (option id) too; value_multi covers multi_select + people (list of ids).
    value_text = models.TextField(null=True, blank=True)
    value_number = models.DecimalField(max_digits=24, decimal_places=8, null=True, blank=True)
    value_date = models.DateField(null=True, blank=True)
    value_multi = ArrayField(models.CharField(max_length=255), null=True, blank=True)

    class Meta:
        unique_together = [["issue", "field", "deleted_at"]]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "field"],
                condition=Q(deleted_at__isnull=True),
                name="work_item_field_value_unique_issue_field_when_deleted_at_null",
            )
        ]
        indexes = [
            models.Index(fields=["field", "value_text"]),
            models.Index(fields=["field", "value_number"]),
            models.Index(fields=["field", "value_date"]),
        ]
```

**Why split columns instead of one JSON `value` column:** filters and sorts
need to push predicates into Postgres (`WHERE value_number > 5`). A JSON column
would require expression indexes per type. Five typed columns + nullable is
simpler and idiomatic Django.

---

## 3. Field type → storage mapping

| field_type      | reads / writes to                                |
| --------------- | ------------------------------------------------ |
| `text`          | `value_text`                                     |
| `number`        | `value_number`                                   |
| `date`          | `value_date`                                     |
| `single_select` | `value_text` (= option UUID as string)           |
| `multi_select`  | `value_multi` (= list of option UUIDs)           |
| `people`        | `value_multi` (= list of workspace member UUIDs) |

Serializer enforces the mapping. Other type columns are NULL on the same row.

---

## 4. Migrations

One Django migration creates all three tables. Number after the latest on
`feature/custom-fields` base (currently `0122`):

```
apps/api/plane/db/migrations/0123_workitemfield_workitemfieldoption_workitemfieldvalue.py
```

No backfill — empty by default; users opt in by creating fields per project.

---

## 5. REST API

Base prefix:
`/api/v1/workspaces/<slug>/projects/<project_id>/`

| Method | Path                                         | Body / Returns                       |
| ------ | -------------------------------------------- | ------------------------------------ |
| GET    | `fields/`                                    | `WorkItemField[]`                    |
| POST   | `fields/`                                    | create field                         |
| PATCH  | `fields/<field_id>/`                         | rename / reorder / config            |
| DELETE | `fields/<field_id>/`                         | soft-delete (is_active=False)        |
| GET    | `fields/<field_id>/options/`                 | `WorkItemFieldOption[]`              |
| POST   | `fields/<field_id>/options/`                 | create option                        |
| PATCH  | `fields/<field_id>/options/<id>/`            | rename / reorder                     |
| DELETE | `fields/<field_id>/options/<id>/`            | soft-delete option                   |
| GET    | `issues/<issue_id>/field-values/`            | `WorkItemFieldValue[]` for one issue |
| PUT    | `issues/<issue_id>/field-values/<field_id>/` | upsert value                         |
| DELETE | `issues/<issue_id>/field-values/<field_id>/` | clear value                          |

Permission: project-level admin/member can read all; admin can write field
schemas; admin/member can write values. No field-level grants in v1.

### Bulk fetch for list view

`GET issues/?expand=field_values` returns each issue with
`field_values: {[field_id]: serialized_value}` to avoid N+1.

---

## 6. Frontend store shape

New MobX store `apps/web/core/store/workspace/work-item-field.store.ts`:

```ts
type TWorkItemField = {
  id: string;
  project_id: string;
  name: string;
  field_type: TWorkItemFieldType;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
  description: string;
  config: Record<string, unknown>;
  options?: TWorkItemFieldOption[]; // hydrated for select/multi_select
};

class WorkItemFieldStore {
  fieldsByProject: Map<string, TWorkItemField[]>;
  fieldValuesByIssue: Map<string, Record<string, TWorkItemFieldValueShape>>;

  getFieldsForProject(projectId: string): TWorkItemField[];
  getValueForIssue(issueId: string, fieldId: string): TWorkItemFieldValueShape | undefined;
  upsertValue(issueId: string, fieldId: string, value: TWorkItemFieldValueShape): Promise<void>;
  // CRUD on field schemas
}
```

Wire into `RootStore` next to `useLabel` / `useState`.

---

## 7. List view plugin hook (integration point with PR1)

PR1 left a column registry at
`apps/web/core/components/issues/issue-layouts/list/columns/list-columns.ts`
with `LIST_COLUMN_ORDER` listing built-in columns. To support custom fields
**without modifying that file every time a project adds a field**, the
custom-fields branch introduces a runtime plugin hook.

### Contract

Add to `list-columns.ts`:

```ts
// Runtime-registered columns are appended after built-ins, in registration order.
const customColumnProviders: Array<() => TListColumnDef[]> = [];

export function registerListColumnProvider(provider: () => TListColumnDef[]): () => void {
  customColumnProviders.push(provider);
  return () => {
    const idx = customColumnProviders.indexOf(provider);
    if (idx >= 0) customColumnProviders.splice(idx, 1);
  };
}

export type TListColumnDef = {
  key: string;
  width: number;
  i18nLabel?: string;
  // For runtime columns, the cell is its own component (no CELL_BY_COLUMN lookup).
  Cell: React.ComponentType<TIssueCellProps>;
  // For sort support (PR2 + custom-fields both consume this)
  ascendingOrderKey?: TIssueOrderByOptions;
  descendingOrderKey?: TIssueOrderByOptions;
};
```

Custom-fields branch will:

1. Subscribe at the top of `default.tsx` to `useWorkItemFields(projectId)`
2. Build a `TListColumnDef[]` from the active fields, one per field
3. Use `registerListColumnProvider` in a `useEffect` to register and return the unregister fn

The bridge file lives at
`apps/web/core/components/issues/issue-layouts/list/columns/custom-field-columns.tsx`.

`list-columns.ts` modifications (custom-fields branch does these, NOT PR2):

- Add the `customColumnProviders` array + register fn
- Rewrite `getVisibleListColumns()` to merge built-in + provider results
- Add `TListColumnDef` type (alongside existing `TListColumnKey` union)

**PR2 (sort) does NOT need to touch this** — sort options operate on
`TIssueOrderByOptions` (in `packages/types`) and are a separate concern. PR2
modifies `packages/constants/src/issue/common.ts` and
`list-header-row.tsx` only.

### Files PR2 + custom-fields BOTH touch (need coordination)

| File                                                   | PR2 change                          | Custom-fields change                        | Conflict risk                                                               |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/types/src/view-props.ts`                     | extend `TIssueOrderByOptions` union | maybe add `custom_field__<id>` orderBy keys | low (different lines)                                                       |
| `packages/constants/src/issue/common.ts`               | extend ISSUE_ORDER_BY_OPTIONS       | add custom-field sort entries               | low (append-only)                                                           |
| `packages/i18n/src/locales/{en,zh-CN}/translations.ts` | add sort labels                     | add `custom_fields.*` keys                  | low (different sections)                                                    |
| `list/columns/list-columns.ts`                         | none                                | add plugin hook                             | none — PR2 doesn't touch this file                                          |
| `list/columns/list-header-row.tsx`                     | add click-to-sort                   | none (runtime cols inherit same header)     | none — custom-fields just registers cols; PR2 makes them clickable for free |

Rule: **rebase PR2 onto `feature/custom-fields` (or vice-versa) before merging
either to mainline.** Whoever merges second resolves the (probably trivial)
conflicts.

---

## 8. Filter integration

`issue-filter.helper.ts` builds backend query params. Custom field filters use:

```
field_values__field_id=<uuid>&field_values__value_text=<value>
```

(or `value_number__gte=`, `value_date__lte=`, etc.)

Backend serializer translates these into ORM `.filter(field_values__...)`.
Detail comes in the custom-fields branch.

---

## 9. Sort integration (post PR2)

After PR2 lands its 24-option sort menu, custom-fields branch adds dynamic
sort entries:

```
ORDER BY value_text   (for single_select / text)
ORDER BY value_number (for number)
ORDER BY value_date   (for date)
```

A query param like `?order_by=custom_field__<field_id>` is parsed server-side
into the right `value_*` column on `WorkItemFieldValue`.

---

## 10. Suggested sequencing (custom-fields branch)

Each numbered step = ~one commit.

1. **Models + migration** (backend only, no API) — done
2. **Serializers + viewsets for schema CRUD** (no values yet) — done
3. **MobX data layer** (types + service + schema store + RootStore wiring +
   `useWorkItemField` hook). Resequenced ahead of the UI (2026-05-15): the
   settings UI, list bridge, peek and filter all depend on it, so the
   schema-side store moved here from old step 6. Value-cache stays in step 6.
4. **Admin UI**: project settings page to manage fields + options — done
   (nav entry, route, list/inline-form/option-editor/item, en+zh i18n)
5. **Value CRUD endpoints + serializer** — done (field_type→column mapping,
   per-type validation, issue-scoped upsert/clear/list)
6. **Bulk fetch** (`?expand=field_values`) + store value cache
7. **List view bridge** (`registerListColumnProvider` + cell renderers per type)
8. **Peek panel** (custom field section in issue detail right-rail)
9. **Filter** (frontend filter chip + backend predicate)
10. **Sort** (depends on PR2 landing in `feature/lark-oauth-provider`)

Steps 1-6 are pure backend / store layer with zero overlap with PR2/PR3.
Step 7 onward touches files also in PR2/PR3 zone — coordinate via rebase.

---

## 11. Deployment

Custom-fields branch pushes GHCR images tagged `lark-custom-fields` (see
`.github/workflows/build-lark-feature.yml`). Staging task.vijimgroup.com keeps
running `lark-stable`.

To preview custom-fields on staging:

```bash
ssh -i ~/.ssh/joby_plane root@134.209.32.248
cd /opt/plane
# Pull the custom-fields-tagged images and retag locally to lark-stable;
# remember to revert when done.
for img in plane-frontend plane-backend plane-admin plane-space; do
  docker pull ghcr.io/jobyinc/$img:lark-custom-fields
  docker tag  ghcr.io/jobyinc/$img:lark-custom-fields ghcr.io/jobyinc/$img:lark-stable
done
docker compose up -d --force-recreate web api worker beat-worker admin space
```

Real merge to mainline: rebase `feature/custom-fields` onto
`feature/lark-oauth-provider`, resolve, then merge.

---

## 12. Open questions (to resolve as we go, not blocking start)

- Should `description` show as tooltip on column header in list view? (Asana does.)
- Date-only vs datetime support? v1 says date-only; might need datetime for v2.
- Permission model: project-admin-only schema edit, or anyone-on-project? Current draft says admin-only.
- Inheritance from project templates? v2.
- ~~Field-type vocabulary vs Asana wire names~~ **RESOLVED 2026-05-15:** v1
  targets Asana parity with exactly 6 types — `text` / `number` / `date` /
  `single_select` / `multi_select` / `people`. No `boolean` (Asana models
  yes/no as a 2-option single-select). Names are human-readable internal
  values; UI labels follow Asana ("Single select" / "People"). Locked in
  step 1 (model + migration + §1/§2/§3 updated).
