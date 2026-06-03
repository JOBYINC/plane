# Tick — agent reference (full)

Authoritative reference for the JOBY agent team. Pair with
`tick-primer.md` (system-prompt blurb) and `custom-fields-token-api.md`
(custom fields deep-dive). Everything here is verified against the
deployed source; where a capability does **not** exist it is stated so
explicitly — do not assume beyond this doc.

---

## 1. What Tick is

Tick = JOBY's self-hosted task manager, a fork of Plane, deployed at
**`https://task.vijimgroup.com`**. It is the system of record for work
items (tasks), projects, cycles (sprints), modules, labels, states,
and typed custom fields. "Tick", "the task manager", "the project
tool" all refer to this. Agents integrate over HTTP.

## 2. Concepts & hierarchy

```
Workspace (slug, e.g. "joby")
  └── Project (UUID = project_id)
        ├── Work item (a.k.a. issue / task; UUID = pk)
        │     ├── comments, links, attachments, activities, relations
        │     └── custom field values
        ├── States (workflow columns), Labels, Cycles, Modules
        ├── Custom field definitions (+ options)
        └── Members (users with a role)
```

- **Workspace** groups projects and members. Identified by `slug`.
- **Project** is the main container. Identified by `project_id` (UUID).
- **Work item** = a task. Same entity Plane calls "issue".
- **Custom fields** are project-scoped typed columns
  (number/text/date/single_select/multi_select/people).
- **Personal "My Tasks"** is a **shipped feature** (Asana-style
  project-less tasks). Each user has one private personal project. It
  has no token-API _create_ route, **but for its owner's token it
  shows up in the normal token project list and is fully usable by
  `project_id`** — do **not** invent a new project for "my/personal
  tasks". Full contract in **§12**.

## 3. Connecting

|                | Value                                           |
| -------------- | ----------------------------------------------- |
| Token API base | `https://task.vijimgroup.com/api/v1`            |
| Auth header    | `X-Api-Key: <token>` (raw string, no prefix)    |
| Identity       | The request runs **as the token's owning user** |
| Content type   | `application/json`                              |

**Two APIs — use the right one:**

- `/api/v1/...` → **token API** (`X-Api-Key`). This is yours.
- `/api/...` (no `v1`) → web app's **session API** (cookie + CSRF).
  Not callable with `X-Api-Key`; ignore it.

**Token model:** an `APIToken` belongs to a user, may have an
`expired_at`, `is_active`, optional workspace association (not
enforced at auth — scoping is by per-endpoint role checks). Two tiers:
normal (~**60 req/min**, env-tunable) and "service" (~**300 req/min**).
**Service tokens can only be set in the DB/Django admin** — there is
no API or `manage.py` path to create one. Rate-limit headers:
`X-RateLimit-Remaining`, `X-RateLimit-Reset`. On `429`, back off.

### Where the API key lives & how it is provisioned

- **A token is not a global master key.** It is tied to one user; the
  request runs as that user and can reach exactly what that user's
  per-workspace/per-project role allows. The token's `workspace` field
  is nullable and not enforced at auth — scoping is purely role-based.
  (If the owning user is ADMIN of many projects/the workspace, the key
  is _effectively_ broad — but it is still "that user's access", not a
  separate global secret.)
- **The key is the `PLANE_API_KEY` secret, already injected into
  agents via MCP.** Use that value directly as the `X-Api-Key`
  header — do not look for it in the Tick UI.
- **Origin (managed by ops):** JOBY **Infisical**
  `http://100.114.0.100:8080/`, reachable over **Tailscale** —
  project **`Plane_Tick_TASK`**, secret **`PLANE_API_KEY`**. Agents
  normally receive it pre-injected (MCP); fetch from Infisical
  directly only if explicitly instructed.
- **Where a human mints/rotates a token (then writes it back to
  Infisical as `PLANE_API_KEY`):** the Tick web UI, logged-in
  session — **Settings → Profile → API tokens** →
  `https://task.vijimgroup.com/settings/profile/api-tokens/`
  (a `/{slug}/settings/api-tokens` link redirects there). This (plus
  Django admin) is the **only** place tokens are created/viewed/
  revoked; it needs a session — **the token API cannot mint tokens**,
  so an agent can never bootstrap or rotate its own key.
- **Agents do not "find" the key in Tick.** It is the injected
  `PLANE_API_KEY`. If that env/secret is missing (or Tailscale →
  `100.114.0.100` is unreachable), that is an ops/access gap to
  escalate — not a self-serve step.
- **Which user/role does a key map to?**
  `GET https://task.vijimgroup.com/api/v1/users/me/` with the key. A
  workspace ADMIN sees all issued tokens on the API-tokens page.
- **Recommended (not enforced):** one dedicated bot user + its own
  token **per agent (or per agent role)**, scoped to only the projects
  it needs, so rate limits, audit trail, and blast radius are
  isolated. A single shared global-admin token is an audit/blast-radius
  risk. (How JOBY currently provisions — one shared vs per-agent — is a
  JOBY-side ops decision, not visible from Tick's code.)

To onboard a new agent: a human creates/reuses a Tick user for it,
adds it to the needed project(s) with a role (see §5), issues an API
token for that user at the URL above, and delivers it to the agent's
secret config.

## 4. Conventions

- **Path scoping:** `slug` and `project_id` are **URL path segments**,
  never body fields. Body `project_id` is ignored.
- **Idempotency (`external_source` + `external_id`):** every writable
  resource that agents create (work items, custom fields, options)
  supports an external key pair. Conventions:
  - `GET .../<resource>/?external_source=<s>&external_id=<i>` →
    `200` + object, or `404`.
  - `POST` with both keys: if the pair already exists →
    **`409` + `{"error":..., "id":"<existing-uuid>"}`** (treat as
    success: use that id). Else `201`.
  - Work items also support **`PUT` upsert** (no `pk` in path):
    `external_id` + `external_source` **required** (`400` if missing);
    existing → `200` updated, absent → `201` created.
  - Custom-field **values** are idempotent by `(issue, field)` — the
    `PUT .../field-values/{fid}/` overwrites the same row, no external
    key needed.
- **Pagination:** cursor-based. Params: `per_page` (default & max
  **1000**), `cursor` (`"<per_page>:<page>:<is_prev>"`, start `0`).
  Response envelope:
  ```json
  { "total_count":0,"count":0,"total_pages":0,"total_results":0,
    "next_cursor":"…","prev_cursor":"…",
    "next_page_results":true,"prev_page_results":false,
    "grouped_by":null,"sub_grouped_by":null,"extra_stats":null,
    "results":[ … ] }
  ```
  Loop while `next_page_results` is true, passing `next_cursor`.
- **`fields` / `expand`:** `?fields=a,b` trims the serialized object;
  `?expand=state,assignees,labels,parent,created_by,…` inlines related
  objects. Without `expand`, `assignees`/`labels` come back as arrays
  of UUID strings.
- **Status codes:** `200` ok / `201` created / `204` deleted/cleared /
  `400` validation / `401` bad-or-missing token / `403` role denied /
  `404` not found or wrong path / `409` idempotency hit (carries the
  existing `id`) / `429` rate-limited.

## 5. Permissions & roles — what "admin" can and cannot do

Roles are **integers per workspace/project**: `ADMIN=20`,
`MEMBER=15`, `GUEST=5`. **There is no standalone "can create tasks"
permission** — capability = the token user's role in that
project/workspace.

Permission classes guarding endpoints:

| Guard                    | Read (GET)             | Write (POST/PATCH/DELETE)                 |
| ------------------------ | ---------------------- | ----------------------------------------- |
| ProjectEntityPermission  | any project member     | ADMIN or MEMBER (GUEST blocked)           |
| ProjectLitePermission    | any project member     | any project member                        |
| ProjectMemberPermission  | any project member     | ADMIN/MEMBER (POST checks workspace role) |
| ProjectAdminPermission   | project **ADMIN**      | project **ADMIN**                         |
| WorkSpaceAdminPermission | workspace ADMIN/MEMBER | workspace ADMIN/MEMBER                    |
| WorkspaceOwnerPermission | workspace **ADMIN**    | workspace **ADMIN**                       |

What that means in practice:

- **Work items / links / comments / cycles / modules / states /
  relations / labels:** read = any project member; create/edit/delete
  = **MEMBER+** (GUEST read-only). Comments & intake: any member can
  write.
- **Custom-field schema** (create/edit/delete fields & options):
  **project ADMIN only**. Setting field **values**: MEMBER+.
- **Project summary / workspace member list:** workspace ADMIN/MEMBER.

### Granting others access (the "give someone task-creation rights"

question)

It is **role assignment**, and only if your token's user has the
required ADMIN role:

| Action                                                        | Endpoint                                                                                                  | You must be                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Add an existing **workspace user** to a project (with a role) | `POST /api/v1/workspaces/{slug}/projects/{pid}/members/` body `{"member":"<user_uuid>","role":20\|15\|5}` | **project ADMIN** of `{pid}` |
| Change a project member's role                                | `PATCH .../projects/{pid}/members/{member_pk}/` body `{"role":20\|15\|5}`                                 | **project ADMIN**            |
| Remove a project member                                       | `DELETE .../projects/{pid}/members/{member_pk}/` (soft-deactivates)                                       | **project ADMIN**            |
| Email-invite a **new** person to the workspace                | `POST /api/v1/workspaces/{slug}/invitations/` body `{"email":"…","role":20\|15\|5}`                       | **workspace ADMIN**          |

Giving someone "permission to create tasks in project X" = add them as
that project's member with role **15 (MEMBER)** or **20 (ADMIN)** via
the first row above.

**Hard limits (not possible via the token API):**

- Cannot mint/rotate API tokens (web-session or Django-admin only).
- Cannot create user accounts (invite only creates an email invite;
  the person must accept — acceptance is not on the token API).
- Cannot change **workspace-level** member roles via the token API
  (`workspaces/{slug}/members/` is GET-only).
- "Directly touching the backend" (DB/`manage.py`/Django admin) is an
  **ops/human SSH operation**, not reachable by an agent. Relevant
  server commands exist (e.g. `manage.py create_project_member
--project_id --user_email --role` defaults to role 20) but only a
  human with server access runs them.

## 6. Endpoint inventory (token API, prefix `/api/v1`)

`{slug}` = workspace slug, `{pid}` = project UUID. Prefer the
`work-items/` family; `issues/` is a deprecated alias of the same
views.

### Work items

| Methods            | Path                                                                             | Guard                   |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------- |
| GET, POST          | `/workspaces/{slug}/projects/{pid}/work-items/`                                  | ProjectEntityPermission |
| GET, PATCH, DELETE | `/…/work-items/{pk}/`                                                            | ProjectEntityPermission |
| PUT                | `/…/work-items/` (upsert; external keys required)                                | ProjectEntityPermission |
| GET                | `/workspaces/{slug}/work-items/search/`                                          | —                       |
| GET                | `/workspaces/{slug}/work-items/{projIdent}-{issueIdent}/`                        | —                       |
| GET, POST          | `/…/work-items/{issue_id}/links/` ; GET,PATCH,DELETE `/…/links/{pk}/`            | ProjectEntityPermission |
| GET, POST          | `/…/work-items/{issue_id}/comments/` ; GET,PATCH,DELETE `…/comments/{pk}/`       | ProjectLitePermission   |
| GET                | `/…/work-items/{issue_id}/activities/` ; `…/activities/{pk}/`                    | ProjectEntityPermission |
| GET, POST          | `/…/work-items/{issue_id}/attachments/` ; GET,PATCH,DELETE `…/attachments/{pk}/` | ProjectEntityPermission |
| GET, POST          | `/…/work-items/{issue_id}/relations/`                                            | ProjectEntityPermission |

### Projects

| Methods            | Path                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| GET, POST          | `/workspaces/{slug}/projects/`                                        |
| GET, PATCH, DELETE | `/workspaces/{slug}/projects/{pk}/`                                   |
| POST, DELETE       | `/…/projects/{pid}/archive/`                                          |
| GET                | `/…/projects/{pid}/summary/` (workspace ADMIN/MEMBER)                 |
| **POST**           | **`/…/projects/{pid}/duplicate/`** — server-side deep clone (see §13) |

### Project templates (session API only — `/api/`, NOT `/api/v1/`)

The template flag (`is_template`) is patched through the existing project
detail endpoint and listed via a dedicated session-API path. **PATCH /
GET templates lives on the session API**, but the **duplicate POST is
on the token API** and is what GTM/marketing agents call.
| Methods | Path | Auth |
|---|---|---|
| GET | `/api/workspaces/{slug}/projects/templates/` | session |
| PATCH | `/api/workspaces/{slug}/projects/{pid}/` body `{is_template: bool}` | session |
| POST | `/api/v1/workspaces/{slug}/projects/{pid}/duplicate/` | token |

### States · Labels

- `GET,POST /…/projects/{pid}/states/` · `GET,PATCH,DELETE /…/states/{state_id}/`
- `GET,POST /…/projects/{pid}/labels/` · `GET,PATCH,DELETE /…/labels/{pk}/` (ProjectMemberPermission)

### Cycles

`GET,POST /…/cycles/` · `GET,PATCH,DELETE /…/cycles/{pk}/` ·
`GET,POST /…/cycles/{cycle_id}/cycle-issues/` ·
`GET,DELETE /…/cycles/{cycle_id}/cycle-issues/{issue_id}/` ·
`POST /…/cycles/{cycle_id}/transfer-issues/` ·
`POST /…/cycles/{cycle_id}/archive/` ·
`GET /…/archived-cycles/` · `DELETE /…/archived-cycles/{cycle_id}/unarchive/`

### Modules

`GET,POST /…/modules/` · `GET,PATCH,DELETE /…/modules/{pk}/` ·
`GET,POST /…/modules/{module_id}/module-issues/` ·
`DELETE /…/module-issues/{issue_id}/` ·
`POST /…/modules/{pk}/archive/` · `GET /…/archived-modules/` ·
`DELETE /…/archived-modules/{pk}/unarchive/`

### Intake (inbox)

`GET,POST /…/projects/{pid}/intake-issues/` ·
`GET,PATCH,DELETE /…/intake-issues/{issue_id}/` (ProjectLitePermission)

### Members & invites

| Methods               | Path                                                      | Guard                                            |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| GET, POST             | `/…/projects/{pid}/members/` (alias `…/project-members/`) | GET ProjectMemberPermission · POST project ADMIN |
| GET, PATCH, DELETE    | `/…/projects/{pid}/members/{pk}/`                         | project ADMIN                                    |
| GET                   | `/workspaces/{slug}/members/`                             | workspace ADMIN/MEMBER                           |
| GET,POST,PATCH,DELETE | `/workspaces/{slug}/invitations/[{pk}/]`                  | workspace ADMIN                                  |

### Custom fields — see `custom-fields-token-api.md`

`/…/projects/{pid}/fields/` , `/…/fields/{fid}/` ,
`/…/fields/{fid}/options/[{oid}/]` ,
`/…/issues/{iid}/field-values/[{fid}/]` ,
`/…/issue-field-values/` (bulk).

### Stickies · Assets · User

- `/workspaces/{slug}/stickies/...` (full CRUD)
- `POST /workspaces/{slug}/assets/` · `GET,PATCH /…/assets/{asset_id}/`
  · `assets/user-assets/...` (upload flow)
- `GET /api/v1/users/me/`

## 7. Work item body schema

`POST`/`PUT`/`PATCH` work-item body (writable fields):

| Field                            | Notes                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- |
| `name`                           | **required**, ≤255 chars                                               |
| `description_html`               | HTML, sanitized server-side                                            |
| `priority`                       | `urgent` \| `high` \| `medium` \| `low` \| `none`                      |
| `state`                          | state UUID; must belong to the project                                 |
| `parent`                         | work-item UUID; must be same project/workspace                         |
| `assignees`                      | list of user UUIDs; filtered to active project members (role ≥ MEMBER) |
| `labels`                         | list of label UUIDs in the project                                     |
| `start_date`, `target_date`      | `target_date` must be ≥ `start_date`                                   |
| `point`                          | int 0–12 (estimate)                                                    |
| `estimate_point`                 | estimate-point UUID (validated)                                        |
| `type_id`                        | custom work-item type, if used                                         |
| `external_source`, `external_id` | idempotency keys (set both)                                            |
| `created_at`, `created_by`       | optional override on create                                            |

Read-only: `id`, `workspace`, `project`, `updated_by`, `updated_at`.
`GET …/work-items/?external_id=&external_source=` → single match.

## 8. Custom fields (summary)

Typed project columns; **use these instead of label hacks** for
structured metadata. Types: `number` (e.g. LD_Offset), `text`,
`date`, `single_select`, `multi_select`, `people`. Schema CRUD =
project ADMIN; value set = MEMBER+; both layers idempotent (fields via
`external_source`/`external_id`, values via `(issue,field)`). Sorting
in the web List view: `?order_by=custom_field__{fid}` /
`-custom_field__{fid}`. Full contract + examples →
**`custom-fields-token-api.md`**.

## 9. Worked examples

```bash
B=https://task.vijimgroup.com/api/v1/workspaces/$SLUG
H=(-H "X-Api-Key: $TOKEN" -H "Content-Type: application/json")

# Idempotent create-or-get a work item
curl -s "${H[@]}" "$B/projects/$PID/work-items/?external_source=gtm&external_id=launch-42"   # 200 reuse / 404 create
curl -s "${H[@]}" -X POST "$B/projects/$PID/work-items/" -d '{
  "name":"Launch checkpoint","priority":"high",
  "external_source":"gtm","external_id":"launch-42"}'          # 201 {id} | repeat -> 409 {error,id}

# Upsert by external key (no pk in path)
curl -s "${H[@]}" -X PUT "$B/projects/$PID/work-items/" -d '{
  "name":"Launch checkpoint (v2)","external_source":"gtm","external_id":"launch-42"}'  # 200 update / 201 create

# Paginate
curl -s "${H[@]}" "$B/projects/$PID/work-items/?per_page=1000"     # read .results, .next_cursor, .next_page_results

# Grant a teammate task-creation rights in a project (you must be project ADMIN)
curl -s "${H[@]}" -X POST "$B/projects/$PID/members/" -d '{"member":"<user_uuid>","role":15}'

# Email-invite a new person to the workspace (you must be workspace ADMIN)
curl -s "${H[@]}" -X POST "$B/invitations/" -d '{"email":"x@joby.com","role":15}'
```

## 10. Known sharp edges

1. **`issues/` vs `work-items/`:** both exist (same views). Use
   `work-items/`. `relations/` only exists on the `work-items/` family.
2. **Wrong custom-field names 404:** it's `fields` / `field-values`,
   not `issue-properties` / `properties` / `issue-types` (those are
   upstream-Plane names; not present here).
3. **Estimates & swagger schema not mounted** on the token API
   (the url modules are not wired) — those endpoints 404 even though
   view code exists. Don't rely on token-API estimate endpoints.
4. **No `projects/personal/` _create_ on the token API — but the
   bucket is NOT hidden from the token project list.** The
   get-or-**create** endpoint (`GET /api/workspaces/{slug}/projects/
personal/`) is web/session only. However the `is_personal`
   exclusion is applied **only on the session API**; the token API
   project queryset does not exclude it. So once the bucket exists,
   the owner's token sees it in `GET /api/v1/.../projects/` and uses
   it by `project_id` like any project. Full detail: **§12**. (What a
   token-only agent _cannot_ do: create the bucket, or reach another
   user's personal bucket.)
5. **No token minting / no user creation via the token API.** Human
   ops step (web UI session or Django admin).
6. **`409` is not an error for idempotent creates** — it returns the
   existing `id`; reuse it.
7. **Service-tier rate limit (300/min) is DB-only**; assume ~60/min
   unless ops confirms your token is service-tier.

## 11. Onboarding checklist (for the JOBY side, per agent)

1. Ops creates/ensures a Tick **user** for the agent (or reuses a bot
   user).
2. A **project/workspace ADMIN** adds that user to each needed project
   with role **MEMBER (15)** (task create/edit) or **ADMIN (20)** (also
   manage fields/members).
3. Ops issues an **API token** for that user at
   `https://task.vijimgroup.com/settings/profile/api-tokens/`
   (Settings → Profile → API tokens; logged-in session required) and
   delivers it to the agent's secret/env as `X-Api-Key`. Prefer one
   token per agent/role, not a shared global-admin token.
4. Give the agent `tick-primer.md` (system prompt) +
   `tick-agent-reference.md` + `custom-fields-token-api.md`.
5. Agent self-tests with the smoke flow in §9 / the custom-fields doc.

## 12. Personal "My Tasks" project (project-less / Asana-style tasks)

**This feature exists and is live.** Do not create a new project just
because a task is "personal", "mine", "a todo with no project", or
"where do my own tasks go". There is already a dedicated per-user
bucket — find and reuse it.

Shipped 2026-05-18 (`feat(projects): Asana-style project-less tasks
via private personal project`), migration `0126_project_personal`
applied, verified end-to-end. In the Tick web UI it appears in the
**Projects list** as **"Personal Tasks"** (zh-CN **"个人任务"**) — a
normal project entry. (The dedicated "My Tasks" sidebar entry was
removed 2026-05-21; the `/my-tasks/` route still resolves to the bucket
as a deep link.) That "Personal Tasks" label is **display-only** — the
API still returns `name` = `My Tasks {SHORT}` (see §12.1), so the
token-side `name`-prefix cross-check below is unchanged. It reuses
100% of the standard issue UI, create flow, states, custom fields,
cycles, layouts — **there is no issue-schema difference** from a
normal project.

### 12.1 What the bucket looks like (server-managed)

Per workspace, per user, exactly one private project, lazily created
on first use:

| Attribute        | Value                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `is_personal`    | `true` (serialized — token `ProjectSerializer` is `fields="__all__"`)                                                                          |
| `personal_owner` | the owning user's UUID                                                                                                                         |
| `network`        | `0` (SECRET — not workspace-discoverable)                                                                                                      |
| `name`           | `My Tasks {SHORT}` where `SHORT` = first 8 hex of the owner's user UUID, upper-cased (numeric suffix on collision, e.g. `My Tasks 1A2B3C4D 1`) |
| `identifier`     | `MT{SHORT}` (≤12 chars; numeric suffix on collision)                                                                                           |
| Membership       | the owner only, auto-added as project **ADMIN**                                                                                                |
| States           | full `DEFAULT_STATES` (Inbox / Todo / In Progress / …)                                                                                         |

So for issue/comment/custom-field CRUD it behaves **exactly** like any
project addressed by `project_id`.

### 12.2 Creating it — session API, now automatic

The session API get-or-creates the bucket. As of 2026-05-21 the
project-list endpoints (`GET /api/workspaces/{slug}/projects/` and
`…/projects/details/`) **auto-ensure** it for every ADMIN/MEMBER caller
— so the bucket is created the first time the owner loads the Tick web
app at all (any workspace view lists projects). `GET
/api/workspaces/{slug}/projects/personal/` (note: `/api/…`, **no `v1`**
— the cookie+CSRF web/session API) remains as an explicit get-or-create.
There is still **no `/api/v1` token-API route** that creates the bucket
— a token-only agent cannot trigger creation.

### 12.3 Finding & using it from the token API (the part to actually do)

On the session API, `list` / `list_detail` now hide only **other**
users' personal buckets — the caller's own is included (changed
2026-05-21). The token API project queryset hides **nothing**, and the
owner is an active ADMIN member — so:

1. `GET /api/v1/users/me/` → note your user `id`.
2. `GET /api/v1/workspaces/{slug}/projects/?per_page=1000` → in
   `results`, pick the project where
   `is_personal == true && personal_owner == <your id>`
   (sanity-cross-check: `name` starts `"My Tasks "`, `identifier`
   starts `"MT"`, `network == 0`).
3. Use that `project_id` for `work-items/`, `field-values/`,
   `comments/`, etc. — identical to any project (you are ADMIN there).

```bash
B=https://task.vijimgroup.com/api/v1
H=(-H "X-Api-Key: $TOKEN" -H "Content-Type: application/json")
ME=$(curl -s "${H[@]}" "$B/users/me/" | jq -r .id)
PID=$(curl -s "${H[@]}" "$B/workspaces/$SLUG/projects/?per_page=1000" \
  | jq -r --arg me "$ME" \
    '.results[] | select(.is_personal==true and .personal_owner==$me) | .id')
# create a personal task (idempotent via external keys, as always)
curl -s "${H[@]}" -X POST "$B/workspaces/$SLUG/projects/$PID/work-items/" \
  -d '{"name":"Reply to vendor","priority":"high",
       "external_source":"my-agent","external_id":"vendor-reply-1"}'
```

### 12.4 Edge cases / hard limits

- **Bucket may not exist yet.** The bucket is auto-created the first
  time its owner loads the Tick web app (any project-list fetch — see
  §12.2), so for any user who has ever signed in to the web app it
  exists. Only if the owner has **never** used the web app is it absent
  → step 2 returns no match, and a token-only agent **cannot create
  it**. Resolution: have the owner sign in to Tick once (or a
  session-capable integration hits `projects/personal/`). **Do not
  substitute a freshly-created normal project for it.**
- **One per user, owner-only.** A token reaches only _its own owner's_
  personal bucket. You **cannot** write into another person's "My
  Tasks" (network SECRET, owner-only membership, no token route to
  join it). "Put this in Alice's My Tasks" via a bot token is not
  possible by design — use a shared project or assign Alice on a
  shared-project work item instead.
- This is `is_personal` / `personal_owner` on the `Project` model —
  not a separate entity. Everything in §6–§9 applies unchanged once
  you have the `project_id`.

---

## 13. Project templates & duplicate (GTM / marketing agents)

JOBY runs launches off **2 long-lived workspace template projects** (per
spec §1 of the project-clone feature request):

- `TEMPLATE_PS_S` — used for "PS" (Premium Stunner) and "S" (Standard) tier launches
- `TEMPLATE_A_B` — used for "A" and "B" tier launches

Each real launch is a server-side **deep clone** of one of these
templates + a date shift + a one-field override (Tier). No client-side
"build launch" loop, no per-issue PATCH cleanup — the spec was driven by
4 production drift incidents in 14 days that came from doing this in
the client.

### 13.1 What a "template" is on the server

A `Project` row with `is_template=True`. Plain boolean flag (DB
column added in migration `0129_project_is_template`). Templates are:

- **Hidden from the main project list** (`GET /api/workspaces/{slug}/projects/`
  and `/projects/details/` filter `is_template=True` out — same convention
  as `is_personal=True`)
- **Visible in the dedicated templates list** (`GET /api/workspaces/{slug}/projects/templates/`)
- **Surfaced in the sidebar's "Templates" group** in the web UI (workspace-level,
  every member sees the same set)
- **Cloned via `POST /api/v1/workspaces/{slug}/projects/{pid}/duplicate/`** — the
  clone has `is_template=False` so duplicates don't multiply the group

### 13.2 Listing templates

```python
import requests

WS = "vijim"
HEADERS = {"X-Api-Key": os.environ["PLANE_API_KEY"]}

# Session API — token won't work here. Use only if your agent has a
# session cookie (most agents won't). For agents the recommended path
# is to keep a small in-config mapping of {tier → template UUID} since
# the templates set changes maybe twice a year.
r = requests.get(f"https://task.vijimgroup.com/api/workspaces/{WS}/projects/templates/", cookies=...)
```

**Practical recommendation for agents**: hardcode the template UUIDs in
your config rather than discovering them every call. They change very
rarely (2 long-lived templates) and the discovery requires session auth.

### 13.3 Marking a project as template (admin one-time setup)

```python
# Session API. Most agents don't have session — this is a one-time
# human operation done from the web UI's Project Settings → Workspace
# template toggle.
requests.patch(
    f"https://task.vijimgroup.com/api/workspaces/{WS}/projects/{PROJECT_ID}/",
    json={"is_template": True},
    cookies=...,
)
```

### 13.4 ⭐ Duplicating a template — the primary GTM agent operation

This is the **only token-API endpoint** in the templates flow. Agents
call this directly with their `PLANE_API_KEY`.

**Endpoint**: `POST /api/v1/workspaces/{slug}/projects/{source_id}/duplicate/`

**Body (all fields optional)**:

| Field                          | Type      | Default                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                         | str       | `f"{source.name} (Copy)"` | Project name on the clone                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `identifier`                   | str       | auto-unique short prefix  | E.g. `GP02260721`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `external_source`              | str\|null | carries from source       | Set to identify your agent (e.g. `"gtm-agent-v1"`)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `external_id`                  | str\|null | null (never carried)      | **MUST be unique per workspace**; convention `{code}:{LD-iso}`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `rebump_target_dates_by_days`  | int       | 0                         | Applied to every issue's `target_date` (and `start_date`)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `rebump_cycle_windows_by_days` | int       | 0                         | Applied to every cycle's `start_date` + `end_date`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `anchor_start_date`            | str       | —                         | ISO date (`YYYY-MM-DD`). Re-anchors the timeline so the template's **earliest** date lands here; every other issue + cycle date shifts by the same delta (overall span preserved). **Overrides `rebump_*`** when set. Anchors the _start_ — to anchor a mid-timeline date (e.g. a launch day inside the timeline) keep computing `rebump_*` yourself.                                                                                                                                     |
| `override_custom_field_values` | obj       | `{}`                      | `{field_name: value}` — applied to every cloned issue. For `single_select`, value is the option NAME (e.g. `{"Tier": "PS"}`)                                                                                                                                                                                                                                                                                                                                                              |
| `issue_date_overrides`         | obj       | `{}`                      | `{source_issue_uuid: {"target_date": "YYYY-MM-DD", "start_date": "YYYY-MM-DD"\|null}}` — pins **specific** cloned issues to absolute dates, keyed by the **source (template) issue UUID**. **Wins over `rebump_*`/`anchor_start_date`** for matched issues; every other issue keeps the uniform shift. For non-uniform "rush launch" compression where uniform shift won't fit. See §13.6. Malformed shape / non-ISO date → 400; unknown UUID keys are ignored (counted but not applied). |
| `is_template`                  | bool      | false                     | When true the clone itself is created as a workspace template (the web "Save as template" path). Normal launch clones leave this false.                                                                                                                                                                                                                                                                                                                                                   |

**Returns 201**:

```json
{
  "id": "4122f1fc-9d8f-4ea5-b0df-b27ec5e4b2b1",
  "name": "GP02 GorillaPod 1K Gen 2 Tripod LD20260721",
  "identifier": "GP02260721",
  "workspace_id": "039a9aaa-2f8d-4e3b-9922-0ae5e9463702",
  "external_source": "gtm-agent-v1",
  "external_id": "GP02:2026-07-21",
  "is_template": false,
  "issue_date_overrides_requested": 0,
  "issue_date_overrides_applied": 0
}
```

> The two `issue_date_overrides_*` counters are **always present** (both
> `0` when you don't pass `issue_date_overrides`). When you do pass it,
> assert `applied == requested` — any gap means one of your keys didn't
> match a source issue (manifest drift); the clone still succeeds but
> those dates were silently not set. See §13.6.

What gets cloned (zero per-field drift; verified §4 of the spec on the
GP02 reference project — 150 issues / 49 blocked_by / 84 single_select
field values / 4 cycles, 0 mismatches):

- All issues (parent + subtask, with `parent_id` remapped to the clone's
  parent UUIDs)
- States, labels, cycles (dates shifted), modules (+members)
- Custom fields + options (option UUIDs remapped in field values)
- Issue → assignee / label / module / cycle attachments
- `blocked_by` relations (both endpoints remapped)
- Project members (same user FKs, same roles)

What's **NOT** cloned (by design):

- Comments / activity log (launch-runtime, not template state)
- Attachments (s3 copy out of scope)
- Webhook subscriptions
- Issue subscribers / reactions / votes / versions

### 13.5 Worked example: GTM agent creates a launch

Marketing agent receives: "Create a launch for GP03 Gorilla Pod, LD
2026-09-30, PS tier."

```python
import os
from datetime import date
import requests

WS = "vijim"
BASE = "https://task.vijimgroup.com"
HEADERS = {"X-Api-Key": os.environ["PLANE_API_KEY"], "Content-Type": "application/json"}

# Hardcoded per-tier template map (agents should keep this in config,
# not discover each call — see §13.2 recommendation)
TEMPLATE_MAP = {
    "PS": ("TEMPLATE_PS_S_UUID_HERE", date(2026, 7, 17)),  # (template_id, template's launch date)
    "S":  ("TEMPLATE_PS_S_UUID_HERE", date(2026, 7, 17)),
    "A":  ("TEMPLATE_A_B_UUID_HERE",  date(2026, 7, 17)),
    "B":  ("TEMPLATE_A_B_UUID_HERE",  date(2026, 7, 17)),
}

def create_launch(code: str, tier: str, launch_date: date, agent_id: str = "gtm-agent-v1"):
    """Create a launch project from the appropriate template.

    `code` is the product code (e.g. "GP03"); `tier` ∈ {PS, S, A, B};
    `launch_date` is the new launch's LD. The function:
      1. picks the right template per tier
      2. computes rebump days as (new_LD − template_LD)
      3. clones server-side with Tier overridden per-launch
    """
    if tier not in TEMPLATE_MAP:
        raise ValueError(f"unknown tier {tier!r}")
    template_id, template_ld = TEMPLATE_MAP[tier]
    rebump_days = (launch_date - template_ld).days

    body = {
        "name": f"{code} JOBY {tier} Launch LD{launch_date.strftime('%Y%m%d')}",
        "external_source": agent_id,
        "external_id": f"{code}:{launch_date.isoformat()}",  # ⚠ must be unique
        "rebump_target_dates_by_days": rebump_days,
        "rebump_cycle_windows_by_days": rebump_days,
        "override_custom_field_values": {"Tier": tier},
    }

    r = requests.post(
        f"{BASE}/api/v1/workspaces/{WS}/projects/{template_id}/duplicate/",
        headers=HEADERS,
        json=body,
        timeout=60,  # ~13s for a 150-issue project; give yourself headroom
    )
    r.raise_for_status()
    return r.json()  # {id, name, identifier, workspace_id, external_source, external_id}


# Agent invocation
clone = create_launch("GP03", "PS", date(2026, 9, 30))
print(f"Launch project: {BASE}/{WS}/projects/{clone['id']}/issues/")
```

> **Shortcut — `anchor_start_date`.** The example above computes
> `rebump_days` because it anchors a _mid-timeline_ date (the LD) and so
> must know each template's own LD. If instead you just want the
> template's timeline to **start on** a given date, skip the per-tier
> `template_ld` map and the subtraction entirely — pass
> `"anchor_start_date": "<iso-date>"` and the server shifts so the
> template's earliest date lands there (span preserved). The web
> "Use template" modal uses exactly this.

### 13.6 Pitfalls & must-knows

- **`external_id` collision = 409 Conflict.** Plane enforces unique
  `(workspace, external_id)` on Project. Use `{code}:{LD-iso}` and
  every launch is naturally unique. Re-running with the same body
  rolls back the partial clone and returns 409 — the natural idempotency
  guard, but you should NOT rely on it for retry logic (failed clones
  leave nothing behind, so the next call is a fresh create).
- **Atomic.** The whole clone runs inside `transaction.atomic()`. A
  mid-clone failure rolls back the entire project — no orphan rows,
  no half-built project. You will NEVER see a partial clone via this
  endpoint (this was incident #4 of the feature spec).
- **`override_custom_field_values` resolves by field NAME** (against
  the clone's fields, not the source's — the field schema is itself
  cloned, but field names are preserved). For `single_select`, value
  is the option NAME (e.g. `"PS"`), and the server looks up the option
  UUID. For `multi_select` pass a list of option names. For other types
  pass the raw value.
- **Date shift is uniform.** `rebump_target_dates_by_days` shifts every
  issue's `target_date` + `start_date` by exactly that many days. If
  the template has Issue X due 14 days before LD, the clone has Issue
  X due 14 days before the new LD. Same for cycles via
  `rebump_cycle_windows_by_days` (independent integer in case you want
  to keep cycle windows but shift issues, or vice versa — almost
  always set them equal).
- **Per-issue dates via `issue_date_overrides`** (for non-uniform "rush
  launches"). When the launch date is closer than the template's standard
  prep window, a uniform `rebump_*`/`anchor_start_date` shift can't fit —
  some tasks have hard floors (production, ad review, sample shipping) and
  must compress unevenly. Compute a per-task schedule yourself and pass
  `{source_issue_uuid: {"target_date": "...", "start_date": "..."|null}}`.
  - **Keyed by the SOURCE (template) issue UUID** (`Issue.id` of the row in
    the template), not the clone's. Keep a committed manifest of template
    task UUIDs per tier — UUID is used (not `external_id` or `name`)
    because the A/B template has zero external_ids and names can collide.
  - **Override wins over the uniform shift** for matched issues only; every
    non-overridden issue still gets `rebump_*`/`anchor_start_date`. So
    compress just the prep tasks and let post-launch tasks ride the rebump.
  - `start_date` is optional/nullable (most template tasks only set
    `target_date`); `null`/absent → clone's `start_date` stays unset.
  - **Validation is strict (fail-loud):** not an object, a value missing
    `target_date`, or any non-ISO date → **400**, nothing cloned. An
    **unknown UUID** key (not a source issue) does NOT fail — it's ignored
    and counted, surfacing as `applied < requested` so you can detect
    manifest drift. **Always assert `applied == requested`.**
- **Performance.** ~13s synchronous for a 150-issue project (4 cycles,
  10 modules, ~500 members, 49 blocked_by relations). Give your HTTP
  call ≥60s timeout. A `bulk_create` optimization is a planned
  follow-up that will bring this under 2s.
- **Permissions.** The token-holder must be a project member of the
  SOURCE template project (admin or member). Marketing/GTM agent
  token holders should be members of every template they need to clone
  — currently 2 templates, so add the agent's token user to both as
  part of agent onboarding.
- **Clone is not a template.** The endpoint sets `is_template=False`
  on the clone, so a cloned launch project shows up in the regular
  Projects sidebar group, not in Templates. This is intentional —
  duplicating a template should produce a launch, not another template.
