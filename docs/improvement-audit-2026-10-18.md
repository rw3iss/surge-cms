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
