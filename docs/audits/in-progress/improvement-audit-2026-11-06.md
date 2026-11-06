# Improvement Audit — 2026-11-06

## 1. Summary
- Project: Surge CMS (`@sitesurge/*` monorepo)
- Working directory: /home/rw3iss/Sites/rw/rw-cms
- Status: in progress
- Scope: every feature since the last audit (2026-10-21, commit `f28ea8ae`) — 107 commits — audited and fixed in six non-overlapping areas, then a lead pass on cross-area follow-ups.

| Area | Findings file | Status |
|---|---|---|
| Social analytics + digests + connections | [social-analytics](improvement-audit-2026-11-06-social-analytics.md) | done |
| AI module + claude-broker + plugin host | [ai-broker](improvement-audit-2026-11-06-ai-broker.md) | done |
| Notifications + forum block | [notifications-forum](improvement-audit-2026-11-06-notifications-forum.md) | done |
| Membership, applications, programs, roles | [membership-roles](improvement-audit-2026-11-06-membership-roles.md) | done |
| Role shells, contributors, partners, affiliates, discounts | [partners-contributors](improvement-audit-2026-11-06-partners-contributors.md) | done |
| Forms, events map, system pages, editors | [forms-events-pages](improvement-audit-2026-11-06-forms-events-pages.md) | done |

### Totals
| Area | Applied | Planned | Skipped / no change |
|---|---|---|---|
| Social analytics | 50 | 2 | 4 |
| AI + broker + plugin host | 14 (+1 lead) | 1 | 1 documented |
| Notifications + forum | 22 (+1 lead) | 2 | 1 |
| Membership + roles | 33 (+1 lead) | 5 | 1 |
| Partners + contributors | 36 (+3 lead) | 0 | 1 |
| Forms, events, pages | 57 (+6 lead) | rest of 72 (see file) | see file |

Lead pass: spoofable `X-Forwarded-For` in login/ban IP + contact messages → `req.ip`; cross-process Nominatim gate (`cache.acquireGate`); visitor-chosen form email recipients limited (3/form/day); revision restore never touches `system_page`/`is_homepage`; site settings reload no longer blanks readers; event JSON-LD `geo`; contributor shell path deny enforced in AdminLayout; Affiliate tab Save saves affiliate settings; checkout refuses a discount that changed between preview and the locked re-check; partial refunds reverse commission proportionally + commission split snapshot (migration 213); last two known cms tsc errors fixed (CampaignDonations).

### Highest-impact fixes
- Plugin secrets (broker token, GiveButter/Shopify/Printify keys) were returned unmasked by admin plugin reads; `plugins:manage` was never checked.
- Push endpoints: SSRF (any internal https URL) — now public https hosts only.
- Membership: applications could be claimed by an unconfirmed account with the applicant's email; double clicks could create two Stripe subscriptions.
- Partner payouts could pay twice after an unclear Stripe error; affiliate commission ignored the order's actual discount.
- Social analytics: two collection runs at once (and the X spend cap) — one running run per platform.
- Login rate limits / IP bans read a client-supplied header.

## 2–4. Findings
See the area files (each has location, problem, fix, risk, status, lead follow-up and verification).

## 5. Execution plan
- Phase A + B: applied by each area agent, verified per package.
- Phase C: implemented where contained to one area; otherwise planned in the area file.
- Lead: cross-area follow-ups (CLAUDE.md, permissions catalog, SDK coverage, generated docs), full verification, commit, deploy.

## 6. Progress log
- 2026-11-06: audit started; six area agents running.
- 2026-11-06: all six areas applied + verified; lead follow-ups applied; partial-refund + snapshot items (partners 14, 15) implemented.
- 2026-11-06: full verification — shared 330, api 2226, cms 598 tests pass; api + cms tsc 0 errors; vite build OK; docs:api regenerated.
