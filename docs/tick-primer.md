# Tick — task manager primer (paste into every agent's system prompt)

**Tick** is JOBY's self-hosted task manager (a Plane fork) at
`https://task.vijimgroup.com`. When a task says "Tick", "the task
manager", or "the project tool", it means this. Use it for all
structured work items, not labels/notes hacks.

## How you talk to Tick

- **API only.** Token API base: `https://task.vijimgroup.com/api/v1`
- **Auth:** header `X-Api-Key: <your token>`. No cookies/OAuth.
  You act **as the user that owns the token** — your reach = that
  user's role in each workspace/project. A token is **not a global
  master key**; it has exactly its owner's access.

### Where is my API key?

- It is the **`PLANE_API_KEY`** secret, **already injected into you via
  MCP** (your normal secret injection). **Just use that value as the
  `X-Api-Key` header — do not go hunting in the Tick UI.**
- Origin: JOBY **Infisical** `http://100.114.0.100:8080/` (reachable
  over **Tailscale**), project **`Plane_Tick_TASK`**, secret
  **`PLANE_API_KEY`**. Ops manages it there; agents normally get it
  pre-injected — don't fetch it manually unless told to.
- It is **not** self-serve and **not** in the Tick UI for you. If
  `PLANE_API_KEY` is absent from your env / MCP context, that is an
  **ops / Infisical-access gap** — escalate, don't improvise (the
  token API cannot mint tokens).
- (Humans only) a new token is _minted/rotated_ in the Tick web UI
  (logged-in session): **Settings → Profile → API tokens** →
  `https://task.vijimgroup.com/settings/profile/api-tokens/`, then
  written back to Infisical as `PLANE_API_KEY`.
- Sanity-check: `GET https://task.vijimgroup.com/api/v1/users/me/`
  with the key (shows which user/role it maps to).
- `/api/v1/...` = your API. `/api/...` (no `v1`) = the web app's
  session API — **not for you**, it 401s without a browser session.
- There is **no CLI**. HTTP only. Server-side `manage.py` / Django
  admin is ops/human-only over SSH — you cannot reach it.

## Golden rules (these cause 90% of mistakes)

1. **Hierarchy:** workspace → project → work item. `slug` (workspace)
   and `project_id` (UUID) are always in the **URL path**, never the
   body.
2. **Use `work-items/`, not `issues/`.** `…/projects/{pid}/work-items/`
   is current; `…/issues/` is a deprecated alias. Endpoint names use
   `work-items`, `fields`, `field-values`. Plane-SaaS names
   (`issue-properties`, `properties`, `issue-types`) **404 here**.
3. **Idempotency = `external_source` + `external_id`.** Always set both
   on create. Re-creating the same pair returns **HTTP 409 with
   `{"error":…,"id":"<existing>"}`** — that is **success**, use that
   `id` (do not treat 409 as failure). Pattern: `GET …?external_source=
&external_id=` (200 → reuse / 404 → create), or `PUT` upsert
   (external_source+external_id **required**, 200 update / 201 create).
4. **Custom fields** carry typed metadata (number/text/date/select).
   Prefer them over cramming data into labels. See the custom-fields
   reference. Setting a value (`PUT …/field-values/{fid}/`) is
   idempotent by (issue, field).
5. **Pagination:** cursor-based. `?per_page=` (default & max **1000**),
   `?cursor=`. Response is an envelope: read `results` and
   `next_cursor` / `next_page_results`, loop until done.
6. **Rate limit:** ~60 req/min per token (`X-RateLimit-Remaining`
   header). Back off on `429`.
7. **"Personal / my / no-project" tasks → use the existing "My Tasks"
   bucket. Do NOT create a new project for them.** Every user has one
   private personal project (Asana-style "My Tasks", live feature). It
   has no token _create_ route, but it **appears in your normal token
   project list**: `GET …/projects/` → the row where
   `is_personal == true && personal_owner == <your id from
/users/me/>` (name starts `My Tasks `, `network 0`). Use that
   `project_id` like any project. Only a logged-in web session / human
   creates the bucket; if it's missing, escalate to a human — never
   fabricate a substitute project. Full contract: reference §12.

## Permissions — what "admin" really means

Roles are integers per workspace/project: **ADMIN=20, MEMBER=15,
GUEST=5**. There is **no "can create tasks" flag** — it is your role.

- Create/edit/delete work items, comments, cycles, etc.: need
  **MEMBER+** in that project (GUEST is read-only for most).
- Custom-field **schema** (create/edit fields & options): **project
  ADMIN** only. Setting field **values**: MEMBER+.
- **Granting others access (only if you are ADMIN):**
  - Add an existing workspace user to a project / set their role:
    `POST|PATCH …/projects/{pid}/members/` — needs you = **project
    ADMIN**.
  - Email-invite a new user to the workspace:
    `POST …/workspaces/{slug}/invitations/` — needs you = **workspace
    ADMIN**; the invitee must accept (acceptance is not via the API).
- **You CANNOT:** mint another API token (web/session/Django-admin
  only), create user accounts, or change workspace-level roles via the
  token API. Token provisioning is a human/ops step.

Full endpoint inventory, request schemas, examples, gotchas →
**`tick-agent-reference.md`** (and `custom-fields-token-api.md` for
custom fields).
