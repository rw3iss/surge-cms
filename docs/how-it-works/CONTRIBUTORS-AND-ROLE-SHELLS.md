# Contributors and role admin shells

Users who are NOT staff can work in the admin through a **role admin shell**:
a reduced admin (sidebar + dashboard) for a role, with what they may DO still
decided by permissions. The first shell is **contributor** — members (often
approved through the Contributor program) who write posts that an editor
reviews before they go live.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Page after sign-in | `roles.login_route` (Settings → Permissions → Roles) | Contributors land on `/admin` (priority 50). |
| Role shell | `packages/cms/src/admin/shells/index.ts` (`ROLE_SHELLS`) | `contributor: { nav: ['posts'], dashboard: 'contributor', paths: ['/admin/posts', '/admin/help'] }`. Staff always get the full admin. |
| Dashboards | `packages/cms/src/admin/dashboards/` (`DASHBOARDS`) | `default` = the staff dashboard; `contributor` = their posts by state + "Write a new post". `RoleDashboard` picks by the shell. |
| Permissions | `posts:read_own`, `posts:write_own`, `posts:delete_own`, `media:read_own`, `media:write_own` (default role `contributor`) + `posts:publish` granted to `contributor` in **Requires approval** mode (migration 191) | The server checks every route; the shell only decides what is visible. |
| Server access | `services/postAccess.ts` (`postAccess`, `shapeOwnPostWrite`) | Staff unchanged; own scope = only posts they wrote (404 otherwise). |
| Review | `services/postReview.ts`, `POST /posts/:id/review` | Approve → published; Return → draft with a note. |

## The contributor's flow

1. Sign in → `/admin` → the contributor dashboard (drafts, waiting for review, published).
2. **Write a new post** (any type except Live). Author is always themselves; Access (subscription gating), Author and comment settings are staff-only and hidden.
3. Status **Submit for review** + Save → status `pending_review`; the team is alerted — "New post up for review" with a **Review the post** link (Settings → Notifications → **Content submissions**, notification `post_submitted`, mail purpose `post_submitted_admin`). Anyone who sets a post to "Waiting for review" triggers it, not only contributors.
4. While pending they may keep editing. Once published they cannot edit it (an editor can). Drafts and pending posts can be deleted by them.
5. They are emailed the result (`post_review_result`): published (link to the post) or returned with the editor's note (shown in their editor too).

## The reviewer's flow

- The **Posts** sidebar item shows a badge with the number of posts waiting for review; the Posts list has a **Waiting for review** filter.
- Opening such a post shows a **Waiting for review** box: an optional note, **Return to author**, **Approve & publish**. Needs `posts:publish` as a plain allow (an approval-mode grant cannot approve).

## Routes opened to non-staff (auth tier `userOrKey`)

`GET/POST /posts`, `GET/PUT/DELETE /posts/:id`, `GET /posts/settings`, post revisions (list/get/snapshot), `PUT /posts/:id/blocks/reorder`, `GET /users/authors`, `GET /media`, `POST /media`, `POST /media/block-upload`. `userOrKey` = any signed-in user OR an `ssk_` API key; the handler checks the permission (API keys keep full access). Every other admin route keeps its staff/admin tier, so entering the shell grants nothing by itself. Uploads check the permission BEFORE multer stores a byte.

## Adding a shell for another role

1. Add `ROLE_SHELLS[<role>] = { nav: [...nav item ids], dashboard?: '<id>', paths?: [...] }`.
2. Optional: a dashboard component in `admin/dashboards/` + one line in `DASHBOARDS`.
3. Give the role a page after sign-in (`admin`) and the permissions its routes need — and move those routes to `userOrKey` with a permission check (never just open the tier).
