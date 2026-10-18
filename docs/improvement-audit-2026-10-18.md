# Improvement Audit — 2026-10-18

## 1. Summary
- Project: Surge CMS (`@sitesurge/*` monorepo)
- Working directory: /home/rw3iss/Sites/rw/rw-cms
- Scope: every feature since the last audit (2026-09-25), ~180 commits, audited in five areas by read-only auditors.
- Total findings: 197 — Phase A 114 (low risk), Phase B 58 (medium), Phase C 25 (structural).

| Area | Findings | A | B | C |
|---|---|---|---|---|
| Gallery + media + video | 43 | 26 | 11 | 6 |
| Blocks + templates + editor | 45 | 27 | 14 | 4 |
| Membership + users + notifications | 36 | 21 | 9 | 6 |
| Shop + Printify + events | 32 | 16 | 11 | 5 |
| Live + discussions + post types + help + misc | 41 | 24 | 13 | 4 |

### Highest-risk findings (fixed first)
- Media single delete / update / upload routes skip `media:write`; direct uploads skip type/size limits.
- Anonymous `GET /entities/post/:idOrSlug` returns drafts and gated post bodies; member-written text reaches `{{ }}` → innerHTML unescaped.
- Legacy `POST /payments/subscribe` bypasses approval / Dev Only / hide-price / minimum rules; admin routes can make anyone sysadmin; concurrent approvals can double-charge.
- Shop/events permissions declared but never checked (refunds, registrant data); order emails unescaped; order-number view exposes buyer email + download tokens; Printify submit not claimed (duplicate orders possible).
- Live bans/kicks bypassable; post Save overwrites server-written live `type_settings` (recordings lost); members-only gallery leaks collection names.

## 2–4. Findings by area
Each area file lists UI/UX, styling and architecture findings with location, problem, fix, risk and phase:
- [Gallery + media + video](plans/audit-2026-10-18/gallery-media.md)
- [Blocks + templates + editor](plans/audit-2026-10-18/blocks-templates.md)
- [Membership + users + notifications](plans/audit-2026-10-18/membership-users.md)
- [Shop + Printify + events](plans/audit-2026-10-18/shop-events.md)
- [Live + discussions + post types + help + misc](plans/audit-2026-10-18/live-discussions-misc.md)

## 5. Execution plan
All phases are applied without a pause for approval (operator instruction, 2026-10-18), one implementer per area on non-overlapping files: Phase A → B → C, each verified (type check, tests, build), then committed and deployed. Status per finding is marked in the area files.

## 6. Status (2026-10-18, after round 2)
Applied in commit `ad4cd6f6` + the round-2 cross-area pass. Per-finding status is in each area file.

| Area | Done | Partial | Skipped (remainder) |
|---|---|---|---|
| Gallery + media + video | 43/43 | P3, P5, F1, A1, A2, U6 | pg_trgm GIN indexes for the usage scan (P3); ~2048px display rendition (U6, needs a second rendition + migration); `admin/gallery/CommitInput.tsx` re-export left for removal |
| Blocks + templates + editor | 45/45 | — | none (template revisions, SSR entity/template blocks, `query`-slot email audience closed in round 2) |
| Membership + users + notifications | 36/36 | S4, S6, A4 | CAPTCHA on applications (S4); notification-settings cache stays in process, TTL only (S6) |
| Shop + Printify + events | 31/32 | SE30 | stop writing legacy `printify_order_id`/`printify_status` (published SDK still reads them); `retryPendingProviderFulfillment` still Printify-only |
| Live + discussions + post types + help + misc | 41/41 | P1, A1, A2, S8 | discussion level-keyed caching (P1 — items carry per-viewer fields); full Settings.tsx split (A1) |

Remaining follow-ups
- DONE: references regenerated (`npm run docs:api` → 593 routes / SDK modules); `sdkModules.test.ts` + `apiReference.test.ts` pass. Round 2 deployed 2026-10-18 (no migrations); round 1 migrations 159, 167, 168, 171, 172, 175, 176 applied on production.
- Event block SSR/mail render only heading + content (needs an event pre-pass like the gallery block).

Docs updated: `CLAUDE.md` (affected bullets), `docs/sdk/entities.md` (public-read rules, `blocks` on template save, `usages`, template revisions), `packages/cms/src/components/admin/ADMIN_STYLES.md` (`CommitInput`, `useFocusTrap`), `docs/how-it-works/{LIVE-SHOWS,COMMENTS-AND-FORUM,GALLERY,shop-go-live-checklist}.md`.
