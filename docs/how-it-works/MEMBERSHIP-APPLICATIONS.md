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
2. **Account + card** (`POST /payments/membership/apply/card`, signed in): creates the
   account if needed, claims the application (token) and saves the card — no charge.

An application without an account (`user_id` NULL, migration 146) shows on /admin/users
under **"N not signed up yet"**; it can be read and rejected, and approved only once the
applicant has an account and a card. A signed-in member who closed the dialog before
adding a card gets **Add my card** in Profile → Membership.

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
- **Review modal** — the answers (a snapshot taken at apply time), the level, the saved
  card, any last error; **Approve & start billing** or **Reject** (optional note).

**Approve** starts the membership now (`membership.startApprovedMembership`):
- already on a paid Stripe subscription → the normal paid→paid switch (proration);
- otherwise → a new Stripe subscription charged **off-session** to the saved card
  (`payment_behavior: error_if_incomplete`). A declined card, or one that needs the
  member present (3-D Secure), fails the approval: the application **stays pending**
  with the error shown, and nothing is half-created.

Then the local subscription is activated, the role synced and the member emailed.
**Reject** charges nothing and emails the member (with the note, if any).

## Data

| Table / column | Purpose |
|---|---|
| `subscription_plans.requires_approval`, `application_form_id` | The level's settings (migration 145). |
| `membership_applications` | One row per application: status `pending / approved / rejected / withdrawn`, the answers snapshot, `submission_id` (Forms), `stripe_customer_id` + `payment_method_id`, `error`, decision. One pending per member (partial unique index). |
| `users.approval_status` | The latest application's status — the Users table filter. |

API: `POST /payments/membership/apply` (+ `/apply/withdraw`) for members;
`/api/v1/membership-applications` (`GET /`, `/summary`, `/:id`, `POST /:id/approve`, `/:id/reject`)
for admins, permission **`memberships.applications:review`** (admin + sysadmin).
SDK: `cms.payments.applyMembership / withdrawMembershipApplication`, `cms.membershipApplications.*`.
