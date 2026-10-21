# Improvement Audit — 2026-10-21

## 1. Summary
- Project: Surge CMS (`@sitesurge/*` monorepo)
- Working directory: /home/rw3iss/Sites/rw/rw-cms
- Scope: every feature since the last audit (2026-10-18, commit `3770169f`), 41 commits, audited and fixed in four non-overlapping areas, then a lead pass on the cross-area and planned items.
- Applied: 50 fixes + 4 small features. Planned only: 10.

| Area | Findings file | Applied | Planned |
|---|---|---|---|
| Group + block style + block editor | [blocks-editor.md](plans/audit-2026-10-21/blocks-editor.md) | 15 | 2 (A12, A14) |
| Components + templates + engine + help | [components-templates.md](plans/audit-2026-10-21/components-templates.md) | 15 | 3 (P2, P3, P4) |
| Gallery + query modal | [gallery-query.md](plans/audit-2026-10-21/gallery-query.md) | 19 | 2 |
| Events | [events.md](plans/audit-2026-10-21/events.md) | 13 | 0 (#12 not an issue) |

### Highest-impact fixes
- Component **Copy** produced an empty component (block-id 409); now one create with the full tree.
- `props.*` values were printed unescaped when the key looked "trusted" (`props.description`); `default(props.x, …)` printed "props.x".
- Anonymous component reads returned `script` + `sampleRecordIds`.
- `event` entity lists could be cached per type, serving a member's list to anonymous visitors.
- Un-register: UTC cut-off blocked same-evening cancels; unverified accounts could match another person's registration (and see their phone on the ticket page).
- Gallery: settings save with Fit = Hug 400'd; Set data… read `featured != true` as `= true`.
- Group: Grid → Row silently deleted cells; email Row/Grid columns did not match the web; lowering columns deleted content without asking.
- Pages API accepted a block parent on another page or inside itself.

### Small features added
- `event_unregistered` mail purpose ("Registration cancelled").
- Admin event modal "Registrations for" date select (recurring events).
- /gallery page title position + alignment; gallery admin ★ Featured badge, filter, bulk action; `{{gallery(dir='desc')}}`.
- Trashed pages: Restore button; block header "(Order N)" tag.

## 2–4. Findings
See the four area files above (location, problem, fix, risk, status) and each file's "Lead follow-up" section.

## 5. Execution
- Phase A + B (low / medium risk): applied, verified, committed and deployed.
- Phase C (planned, needs its own session):
  - A12: page routes check no `pages:*` permission and there is no `pages:delete`.
  - A14: the `.block--ordered` `:has` rule makes any parent a flex column.
  - P2: email/SSR resolve component text early without the outer `{{ user.* }}` / unsubscribe / page variables.
  - P3: Copy / editor saves inline block-style template refs (`style:{id}`); needs a server-side copy via `cloneBlockTree`.
  - P4: `findForRender` has no server cache.
  - Gallery: suggestion-menu keyboard navigation; overlay title on a letterboxed (contain) tall picture.

## Verification
- shared: build OK; 237 tests pass.
- api: tsc clean; 1908 tests pass.
- cms: tsc shows only the known SocialBlock / CampaignDonations / FormSubmissions errors; 486 tests pass; vite build OK.
- `npm run docs:api` regenerated (gallery settings route input).
- Known, pre-existing: `cms-client` `check:drift` lists older un-exposed routes (wiki, settings, video share, …) — not from this pass.

## Docs updated
CLAUDE.md (Events, Group, block order, escaping, slots, components, gallery, entity caching), `docs/how-it-works/GALLERY.md`, help references (`reference.ts`, `sdkReference.ts`), generated API docs.
