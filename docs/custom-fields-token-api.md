# Tick custom fields — public token API (for JOBY AI agents)

Reference for GTM Director / HR agents (`tick_client`) to write **structured
custom-field metadata** on issues instead of the lossy label hack.

> **TL;DR fix for the 404s you saw:** the endpoints exist — you were probing
> upstream-Plane names. This fork calls the feature **`fields` / `field-values`**
> (model `WorkItemField`), **not** `issue-properties` / `properties` /
> `issue-types`. Those names 404 by design. No feature flag / license gate —
> works on any project today.

---

## Auth & conventions

- **Base:** `https://task.vijimgroup.com/api/v1`
- **Auth header:** `X-Api-Key: <APIToken>` (same token API you already use; no change).
  The key = the **`PLANE_API_KEY`** secret already injected via MCP —
  use it directly; don't hunt in the Tick UI. Origin (ops-managed):
  JOBY Infisical `http://100.114.0.100:8080/` (Tailscale), project
  **`Plane_Tick_TASK`**, secret **`PLANE_API_KEY`**. Per-user, not a
  global key; humans mint new ones at
  `https://task.vijimgroup.com/settings/profile/api-tokens/` then
  store back to Infisical. Details: `tick-agent-reference.md` §3 /
  `tick-primer.md`. Check yours: `GET /api/v1/users/me/`.
- **project_id is in the URL path**, never the body:
  `/workspaces/{slug}/projects/{project_id}/...`
- **Permissions:** read = any project member; **schema create/update/delete = project ADMIN**; setting values = member.
- **Field types:** `text` · `number` · `date` · `single_select` · `multi_select` · `people`
  (Asana set; no boolean — model yes/no as a 2-option single_select.)

## Idempotency contract (same as Issue / your `ensure_*`)

`WorkItemField` and `WorkItemFieldOption` now carry `external_source` +
`external_id`. The `ensure_*` pattern:

1. `GET .../fields/?external_source=<src>&external_id=<id>`
   → `200` + the object if it exists, `404` if not.
2. If `404` → `POST .../fields/` with `external_source` + `external_id` in the body.
3. Race fallback: a `POST` whose `(project, external_source, external_id)`
   already exists returns **`409`** with `{"error": "...", "id": "<existing-id>"}`
   — use that `id` (mirrors the Issue create contract; not a hard error).

**Values are idempotent by construction** — the value upsert is keyed on
`(issue, field)` from the URL, so repeating a `PUT` just overwrites the same
row. No `external_id` needed for values.

---

## Endpoints

### Field schema

| Method   | Path                                                                      | Notes                                              |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET`    | `/workspaces/{slug}/projects/{pid}/fields/`                               | list all fields (members)                          |
| `GET`    | `/workspaces/{slug}/projects/{pid}/fields/?external_source=&external_id=` | single lookup → 200 / 404                          |
| `POST`   | `/workspaces/{slug}/projects/{pid}/fields/`                               | create (ADMIN); idempotent → 409+id                |
| `GET`    | `/workspaces/{slug}/projects/{pid}/fields/{fid}/`                         | retrieve                                           |
| `PATCH`  | `/workspaces/{slug}/projects/{pid}/fields/{fid}/`                         | update (ADMIN)                                     |
| `DELETE` | `/workspaces/{slug}/projects/{pid}/fields/{fid}/`                         | archive (ADMIN, sets is_active=false; values kept) |

### Select options (only `single_select` / `multi_select`)

| Method             | Path                                                                              | Notes                               |
| ------------------ | --------------------------------------------------------------------------------- | ----------------------------------- |
| `GET`              | `/.../fields/{fid}/options/` (`?external_source=&external_id=` for single lookup) | list / lookup                       |
| `POST`             | `/.../fields/{fid}/options/`                                                      | create (ADMIN); idempotent → 409+id |
| `PATCH` / `DELETE` | `/.../fields/{fid}/options/{oid}/`                                                | update / archive (ADMIN)            |

### Values on an issue

| Method   | Path                                                                                       | Notes                            |
| -------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `PUT`    | `/.../issues/{iid}/field-values/{fid}/`                                                    | set/upsert one value; idempotent |
| `DELETE` | `/.../issues/{iid}/field-values/{fid}/`                                                    | clear the value                  |
| `GET`    | `/.../issues/{iid}/field-values/`                                                          | all values on one issue          |
| `GET`    | `/.../issues/{iid}/field-values/` `?` n/a — bulk: `/.../issue-field-values/?issue_ids=a,b` | hydrate many issues at once      |

**`value` shape by field_type** (in the `PUT` body `{"value": ...}`):

| field_type      | value                                             |
| --------------- | ------------------------------------------------- |
| `number`        | a number, e.g. `42` (returned as `"42.00000000"`) |
| `text`          | a string                                          |
| `date`          | ISO date `"2026-05-20"`                           |
| `single_select` | the **option id** (uuid string)                   |
| `multi_select`  | list of option ids                                |
| `people`        | list of workspace-member ids                      |

### Sorting (bonus — humans, in the Web UI's List view)

`GET /.../issues/?order_by=custom_field__{fid}` (asc) or
`-custom_field__{fid}` (desc). Works on the app + token issue list.
`number` / `date` / `text` sort meaningfully; `single_select` sorts by the
option id (not label) — a known limitation.

---

## Worked example — `LD_Offset` (number) end to end

```bash
BASE=https://task.vijimgroup.com/api/v1/workspaces/$SLUG/projects/$PID
H="-H X-Api-Key:$TOKEN -H Content-Type:application/json"

# 1. ensure the field (idempotent)
curl -s "$BASE/fields/?external_source=joby-gtm&external_id=ld_offset_v1" $H      # 200 -> use .id ; 404 -> create:
curl -s -X POST "$BASE/fields/" $H -d '{
  "name":"LD_Offset","field_type":"number",
  "external_source":"joby-gtm","external_id":"ld_offset_v1"
}'                                                                                # 201 {id,...}  | repeat -> 409 {error,id}

# 2. set the value on an issue (idempotent upsert)
curl -s -X PUT "$BASE/issues/$ISSUE_ID/field-values/$FIELD_ID/" $H -d '{"value": 42}'   # 200

# 3. read it back
curl -s "$BASE/issues/$ISSUE_ID/field-values/" $H        # [{field:<fid>, value:"42.00000000", ...}]
```

`single_select` (e.g. `Tier` = PS/S/A/B): create the field
(`field_type:"single_select"`), `POST` each option to
`/fields/{fid}/options/` (idempotent via `external_source`+`external_id`),
then `PUT` the chosen **option id** as the issue value.

## Migrating off the label hack

`Task_ID` → `text`; `LD_Offset` / `Importance` → `number`;
`Tier` / `Phase` / `Approval_Required` → `single_select` (+ options).
Set per issue via the value `PUT`. Frees the 200-label quota and makes
each a typed, filterable, sortable column.

## Notes / gotchas

- These are **internal-app-API mirrors** on the token API; auth is
  `X-Api-Key`, not session — no cookies/JWT needed.
- `DELETE` on a field is an **archive** (`is_active=false`); the name stays
  reserved and existing values are kept. A new field can reuse a name only
  after a real soft-delete.
- Field name is unique per project among live fields (`409`/`400` on dup
  name without external keys; with external keys you get the idempotent
  `409`+id instead).
- A token scoped to project A cannot write a value onto project B's issue
  (the value endpoint verifies the issue belongs to the path's project).
