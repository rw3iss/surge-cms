# Membership applications (levels that require approval)

A membership level can **require approval**. Members then *apply* instead of joining:
they answer an application form and save a card, and **nothing is charged until an
admin approves**.

## Setup (admin)

Users → Settings → Memberships → edit a level:

| Setting | Effect |
|---|---|
| **Require approval** | The level's button reads **Apply** on /subscribe, sign-up and Profile → Membership. |
| **Application form** | *Built-in form* (Name, Email, Phone number, Occupation) or any **Forms** entity. A chosen form must be **published**. |

With a Forms entity, the application is submitted through the normal Forms pipeline,
so that form's own settings apply: **Save submission**, **Email** the submission
(`actionConfig.emailTo`), **Add submitter as Contact**. With the built-in form, the
**Membership application** notification (Settings → Notifications) emails the admins.

## Two steps: submit first, then account + card

Applying is split so the request reaches the team **at once** — someone calls the
applicant, even if they never finish signing up:

1. **Submit** (`POST /payments/membership/apply/submit`, signed in or not): the answers
   go through the form pipeline (or the notification) now. The member sees
   *"Your request has been submitted. Expect a phone call from someone from <site> soon."*
   A signed-out applicant gets a signed **token** (kept in `sessionStorage`) to claim it.
   The applicant is also emailed (mail purpose **`membership_application_received`**,
   Users → Settings → Email templates) with a **Finish my application** link —
   `/profile?tab=membership&claim=<id>&token=<token>` — that claims it on any device.
   Guards for this anonymous, mail-sending endpoint: 10 submits per IP per hour
   (Redis-backed), a hidden honeypot field (`website`), and one pending account-less
   application per (email, level) — a repeat returns the same one and sends nothing.
2. **Account + card** (`POST /payments/membership/apply/card`, signed in): creates the
   account if needed, claims the application (token) and saves the card — no charge.

An application without an account (`user_id` NULL, migration 146) shows on /admin/users
under **"N not signed up yet"**; it can be read and rejected, and approved only once the
applicant has an account and a card. A signed-in member who closed the dialog before
adding a card gets **Add my card** in Profile → Membership (the wall and /subscribe say
"Add your card to finish your application" too).

**Automatic claim.** When an account's email is **proven** — the verification link, or an
invite link to the same address — every account-less pending/approved application sent
from that address is attached to it (`claimByVerifiedEmail`). An unverified address never
claims anything: otherwise anyone could sign up as the applicant and take the application.

## What the member sees

| Where | Flow |
|---|---|
| /subscribe, signed in | **Apply** → modal: application → card (SetupIntent, no charge) → "Application received". |
| /subscribe, signed out, membership required | /join: Plan → **Application** → Account → **Card** → done. The account is created and stays pending. |
| /subscribe, signed out, membership optional | Log in → back to /subscribe with the application open. |
| Profile → Membership | **Apply for X** in the chooser; a pending notice with **Withdraw application**. |
| Gated content / the subscription wall | "Your application for X is waiting for approval." |

The member does **not** have the level while pending: no `subscriptions` row exists, so
every content gate (posts, forum, events, live shows) still treats them by their current
level. In membership-required mode a pending member without another qualifying
membership sees the wall with the pending message (`access.reason = 'pending_approval'`).

## Review (admin)

- **/admin/users** — a "N pending applications" pill beside the title filters the table
  (`?approval=pending`); an **Approval** filter (pending / approved / rejected) sits in the
  filter bar; pending rows have **Review**.
- **User detail** — a *Membership application* panel lists the member's applications.
- **Review modal** — the answers (a snapshot taken at apply time), the level, **what
  approval charges** (the price the applicant chose, e.g. "$1,500.00 every 2 weeks"), the
  saved card, any last error; **Approve & start billing** or **Reject** (optional note).

**Approve** starts the membership now (`membership.startApprovedMembership`):
- already on a paid Stripe subscription → the normal paid→paid switch (proration);
- otherwise → a new Stripe subscription charged **off-session** to the saved card
  (`payment_behavior: error_if_incomplete`). A declined card, or one that needs the
  member present (3-D Secure), fails the approval: the application **stays pending**
  with the error shown, and nothing is half-created.

Then the local subscription is activated, the role synced and the member emailed.
**Reject** charges nothing and emails the member (with the note, if any) — mail purpose
`membership_application_rejected`.

**One approval at a time.** Approve first CLAIMS the application
(`membership_applications.approving_at`, migration 167, one conditional UPDATE) before
Stripe is called, and the Stripe create carries an idempotency key tied to that claim.
A second Approve (another admin, another tab, a retried request) gets *"This application
is being approved by someone else right now"* instead of a second charge. A claim older
than 5 minutes (a crash mid-approval) may be retaken.

**The team is told** when an application arrives, when the applicant adds their card
("ready to approve"), and when they withdraw it — all on the *Membership application*
notification (Settings → Notifications).

## Hide price (approval levels)

A level that requires approval may also **hide its price** (TierModal → *Hide price*, under
*Require approval*; the *Custom price display* section shows only when Hide price is off).

| Step | What happens |
|---|---|
| Browsing | /subscribe, sign-up and the profile show no price, frequency or billing choice for that level — only **Apply** ("Pricing shared after approval"). |
| Applying | The answers only — **no card**. A signed-out applicant creates the account afterwards and the application is attached with `POST /payments/membership/apply/claim` (claim token). |
| Approve | Makes an **offer**: status approved, **nothing charged**, the member is emailed a link to choose billing (`membership_application_approved`; an account-less applicant gets a claim link). The offer is open **30 days** (`offer_expires_at`, migration 167); after that it no longer counts. |
| Withdraw offer | Review modal → **Withdraw offer** (`POST /membership-applications/:id/withdraw-offer`) while the member has not started it: status `withdrawn`. |
| Offer | `access.approvedOffer` (and `isApproved` on the tier). The SPA forwards the member to Profile → Membership once per session; the prices now show, the member picks billing, pays, and the membership starts (`activated_at` set). |

While an application is pending, the SPA re-reads `/auth/me` every 60 s, so a signed-in
member sees the approval without reloading.

## Programs ("Add its role only")

A level with **Add its role only (a program)** on (TierModal; `subscription_plans.role_only`,
migration 186) is for programs like Affiliate or Contributor, not memberships. It always requires
approval, has no price and takes no card.

| Question | Answer |
|---|---|
| What approval does | Adds the level's **role** to the member's **additional roles** (`users.extra_roles`). Their membership level, main role and billing are unchanged — a paying member stays a member AND becomes a contributor. |
| Applicant has no linked account | A **verified** account using the application's email is linked and gets the role at once. **No account** → an invitation (`user_invites`, carries the role) — the role is there when they sign up. An **unverified** account → approval is refused with a message: link it in the review panel, or the role is added when that address is verified. |
| Where it shows | Not on /subscribe or profile Membership (not a membership). List it with `{{ membershipLevels(levels='slug,…') }}`, e.g. /partner-program. A viewer who already has the role sees "You're in". |
| Pending | One pending application per program — a member can apply to SEVERAL programs at once, and to a membership too (still one pending membership application). Enforced by two partial unique indexes on `membership_applications` (`program`, migration 188). The member's Approval status stays Pending while any application waits. Each approval adds that program's role. |
| Buying it | Refused — a program is joined by applying. |
| Removing it | Remove the role from the user's additional roles (user page). |

### Members manage their programs (Profile → Membership → Programs)

The Membership tab lists every program the member belongs to or applied to (`GET /payments/membership/programs`, `cms.payments.membershipPrograms()`; hidden when there are none), with its state — Member / Pending review / Not approved / Withdrawn:

- **Cancel application** (pending) → `POST /payments/membership/apply/withdraw { applicationId }` (`cms.payments.withdrawMembershipApplication(id)`). Without an id it withdraws only the pending MEMBERSHIP application — never the program ones.
- **Leave program** (member) → `POST /payments/membership/programs/:tierId/leave` (`cms.payments.leaveMembershipProgram(tierId)`): removes the role from the member's additional roles; the approval is kept on record as withdrawn.

Both send the team a notice on the **Membership application** notification (Settings → Notifications), with **View member** (the user's admin page) as the first link.

The "Application received" email's button reads **Finish my application** only when something is left to do (signed out → create the account; a card still to add); a signed-in program applicant gets **View my applications** (`application.viewUrl`). The "not approved" email mentions the card only when one was saved (`application.card`).

## Linking applications to accounts

An application sent while signed out is linked to an account when:
- the applicant opens the claim link from their email while signed in, or
- an account with the same email is **verified** (sign-up verification, an admin marking it verified, an invite), or
- a **verified** account with that email **signs in** (`authenticateWithEmail` → `claimByVerifiedEmail`), or
- an admin clicks **Link to this account** in the review panel, which shows the account already using the application's email (`matchedAccount`; `POST /membership-applications/:id/link`, only that account).

An approved program's role is added the moment it is linked.

## Data

| Table / column | Purpose |
|---|---|
| `subscription_plans.requires_approval`, `application_form_id` | The level's settings (migration 145). |
| `subscription_plans.hide_price`, `membership_applications.activated_at` | Hide price + when an approved offer was started (migration 150). |
| `membership_applications` | One row per application: status `pending / approved / rejected / withdrawn`, the answers snapshot, `submission_id` (Forms), `stripe_customer_id` + `payment_method_id`, `error`, decision. One pending per member (partial unique index). |
| `users.approval_status` | The latest application's status — the Users table filter. |
| `membership_applications.approving_at`, `offer_expires_at` | Approval claim (no double charge) + when an offer ends (migration 167). |

API: `POST /payments/membership/apply` (+ `/apply/withdraw`) for members;
`/api/v1/membership-applications` (`GET /`, `/summary`, `/:id`, `POST /:id/approve`, `/:id/reject`)
+ `POST /:id/withdraw-offer` for admins, permission **`memberships.applications:review`** (admin + sysadmin).
SDK: `cms.payments.applyMembership / withdrawMembershipApplication`, `cms.membershipApplications.*`.

## Changing billing on your own level

A member already on an approval level may switch between that level's prices (monthly ↔
yearly) without applying again — approval is checked on the LEVEL, not the price. Up/down
wording and the "price difference" compare prices **per month** (`perMonthCents` in
`@sitesurge/types`), so $25 / month → $250 / year is not an "upgrade".

## Levels hidden from the subscription tiers

A level with **Hide from subscription tiers** on (TierModal; was "Dev only", same column
`subscription_plans.dev_only`, migration 151; API field `hiddenFromTiers`, `devOnly` kept as a
deprecated alias) is not offered on `/subscribe`, at sign-up or on the profile Membership page —
e.g. a test level at a token price, or a level you only assign by hand.

| Question | Answer |
|---|---|
| Who sees it and can buy it | **Nobody** through self-service — admins included. A member already on it still sees it, and an approved application's offer for it still shows. Admins assign it on the user's page (`PUT /users/:id/subscription`). (The old `memberships:dev_levels` permission is gone.) |
| Subscription-required minimum | Exempt: it is offered and sold below the minimum, and holding it **counts as a qualifying membership** (the member is not walled). |
| Rank (post / forum gates) | Rank **0**, like Free (migration 168). It never takes a paid rank, so a $1 test level does not move the real levels up. A gate that needs a paid tier does not open for it. |
| Legacy `POST /payments/subscribe` | Goes through the same rules (`membership.change`) — it can no longer join an approval, hidden or below-minimum level directly. |
