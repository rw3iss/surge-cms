# Contributor payouts and the Partner Program

Contributors (see CONTRIBUTORS-AND-ROLE-SHELLS.md) write posts that an editor
reviews. With **contributor payouts** on, every contributed post an admin
approves earns its author a payout, paid to their own Stripe account.

## Settings — Posts → Settings → Contributions

`contributor_settings` (`services/contributions/settings.ts`, `GET/PUT /api/v1/contributions/settings`):

| Setting | Meaning |
|---|---|
| Pay contributors for approved posts (`enabled`) | The program on/off. Off: approvals publish as before, nothing is credited. |
| Default payout (`defaultPayoutCents`) | Credited for each approved contribution unless the reviewer overrides it. |
| Currency | 3 letters (usd). |
| Holding period (`holdDays`) | Days after approval before an earning is payable. |
| Automatic payouts (`payoutSchedule`) | off / weekly / every 2 weeks / monthly (`contributor-payouts` cron, `isPayoutDue`). A manual Pay out is always available. |
| Connect webhook signing secret | SHARED with the affiliate program (`partner_settings`). |

## The flow

1. A contributor submits a post (status `pending_review`).
2. A reviewer opens it: the **Waiting for review** box has a **Payout** field (the default, editable) → **Approve, publish & pay** (`POST /posts/:id/review { action: 'approve', payoutCents }`).
3. `contributions.onApproved`: the post is published (one reviewer per submission — a second reviewer pressing at the same time is told someone else is reviewing it), a `contribution_earnings` row is credited (`available_at` = now + holding period) and the **Contribution published** emails go out — to the author (`contribution_published`) and to the team (notification `contribution_published`, purpose `contribution_published_admin`). Staff authors are never credited.
4. Until it is PAID an admin may **change the payout**, **revoke** it, or **unpublish** the post (Posts → Contributions, or the post editor's "Contribution payout" box). A revoked payout can be re-credited by setting an amount again. A post approved before the program was on can be credited the same way. Changing an amount never touches an earning a payout has already claimed, and the payee follows the post's CURRENT author. If crediting fails (e.g. the post's earning is already paid) the author gets the plain review email, not "credited".
5. Payouts: Posts → Contributions → Payouts — **Pay selected** / **Pay everyone payable** (`POST /contributions/payouts`), or automatically on the schedule. Pay selected asks first (payees + amount) and skips rows with nothing payable or no ready Stripe account. On Posts → Settings → Contributions the header **Save** saves the contributor settings; the form does not save when the settings failed to load.

States (filters on Posts → Contributions): `pending_review`, `returned` (draft after review), `approved` (published, earning unpaid or none), `paid`, `revoked`.

## The shared partner layer (`services/partners/`)

Affiliates and contributors are both PARTNERS:

- **One Stripe Connect Express account per user** (`affiliate_accounts`), created from Profile → **Partner Program** (`/api/v1/partners/me/stripe/*`). The platform is the shop's Stripe account, else the site default. Stripe needs **Connect** with the platform profile completed.
- **Payouts** (`affiliate_payouts`) carry a `source` (`affiliate` | `contribution`): each program pays only its own earnings (`payOutSource`), so paying a contributor never sweeps up their affiliate commissions.
- Migration 194 made these two tables core (they were created by the affiliates feature), so contributors are paid without the shop/affiliates installed; the affiliates feature now owns only `affiliate_earnings`.
- **Payout safety** (`services/partners/payouts.ts`):

  | Transfer outcome | Payout | Earnings |
  |---|---|---|
  | Stripe accepted | `paid` + transfer id | `paid` |
  | Stripe refused (4xx: no balance, account not ready, rate limit) | `failed` + error | released — payable again |
  | Unclear (network, timeout, Stripe 5xx) | stays `pending` + error | stay claimed |
  | Accepted, but our DB write failed | stays `pending` | stay claimed |

  The next payout for that partner + program (manual, or the cron — `payableUsers` includes partners with a pending payout) RESUMES a pending payout older than 2 minutes: it looks the transfer up at Stripe (`transfer_group = payout_<id>`, or `metadata.payoutId` for older payouts) and records it, or creates it with the SAME idempotency key. One pending payout per partner + program (unique index, migration 212); a second run gets "A payout … is already in progress". Each run pays ONE currency (the oldest payable row's); others follow on the next run.
- **Connect webhook**: a Stripe endpoint on **Events on connected accounts** → `account.updated` → `/api/v1/payments/webhook`; its signing secret in `partner_settings.connectWebhookSecret` (editable in either program's settings).

## Profile → Partner Program

`?tab=partners` (`?tab=affiliate` still works), shown when the user is an affiliate (affiliates feature on + the affiliate role) or a contributor (payouts on + `posts:write_own`). Top: the Stripe connection and totals (pending / payable / paid across programs). Below: **Affiliate sales** and **Contributions** tabs (`?program=`). API `GET /api/v1/partners/me` (`PartnerMeResponse`), permission `partners:self`.

## Permissions

`contributions:manage` (admin) — settings, the Contributions view, change/revoke/unpublish, pay out. The settings READ is open to staff (reviewers need the default payout). `partners:self` — the Partner Program page (members+).
