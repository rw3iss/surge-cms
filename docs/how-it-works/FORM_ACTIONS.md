# Form Actions

Each form has **one** action, chosen in the Form editor (Form Details → *On submit*).
The action runs **after** the submission is saved, so the admin always keeps a
record of every submission regardless of the action.

| Action | What it does |
|--------|--------------|
| `submit` (default) | Saves the submission only — the current behavior. Admins view responses in the Submissions inbox. |
| `subscribe` | Saves the submission **and** subscribes the submitter to a chosen mailing list (respecting that list's double-opt-in). Requires an email field on the form. |
| `email` | Saves the submission **and** emails a target address with a templated body/subject built from the submitted values. |

Action config is stored on `forms.action` (`VARCHAR(16)`, default `submit`) and
`forms.action_config` (`JSONB`). Dispatch lives in
`packages/api/src/services/formActions.ts`; it is best-effort — an action
failure is logged but never fails the user's submission.

## Field variables (`{{ … }}`)

The `email` action's **To**, **Subject**, and **Body** are run through the same
`{{ … }}` template engine used by content blocks, with the submitted form values
as variables. Each question gets a stable variable key derived from its text via
`deriveFieldKeys()` (`@sitesurge/types` → `packages/shared/src/utils/formFields.ts`),
shared by the backend (building the render context) and the editor (the
variables help list) so the tokens always match.

- A question titled **"Email Address"** → `{{email_address}}`.
- Duplicate-derived keys get numeric suffixes (`{{name}}`, `{{name_2}}`).
- Extra tokens: `{{form_title}}`, `{{submitted_at}}` (a real date).
- In the **Body**, submitted values are HTML-escaped (the body is HTML, values
  are untrusted). The **To**/**Subject** use raw values (plain text).

Values can also be run through the shared **value functions** (the same set
available in content blocks): `upper`, `lower`, `trim`, `truncate`, `formatDate`,
`formatCurrency`, `formatNumber`, `default`, `now`, `year` — e.g.
`{{upper(email)}}`, `{{formatDate(submitted_at)}}`, `{{default(name, 'there')}}`.
Defined once in `@sitesurge/types` (`resolveValueFunction`) and shared by the
content SSR, client, and form-email runtimes.

## subscribe

`action_config = { mailingListId }`. On submit the dispatcher resolves the list,
finds the submitter's email (a question of type `email`, or whose derived key is
`email`), optional `name`/`phone` (derived keys), and calls
`mailingLists.publicSubscribe(list.slug, { email, name, phone }, actor)`. Gated
on the `mailing_lists` feature (skipped + logged if disabled). Double-opt-in and
dedup are handled by the mailing-list service.

## email

`action_config = { emailTo, emailSubject, emailBody }`. `emailTo` may be a
literal address or a template (e.g. `{{email}}` to reply to the submitter). Sent
via `services/email.ts` `sendEmail()` (SMTP provider). Invalid/empty recipient
after rendering → skipped + logged.

## Anti-double-submit

Two independent guards:

1. **Per-render nonce** — the public `FormRenderer` generates a `crypto.randomUUID()`
   nonce on mount and sends it with the submission. `form_submissions.nonce`
   plus a partial unique index `(form_id, nonce)` make the insert idempotent
   (`ON CONFLICT … DO NOTHING`), so an accidental double-click / resubmit records
   once and fires the action once.
2. **Max submissions** — optional `forms.max_submissions` cap. When
   `submission_count >= max_submissions`, submissions are rejected with a 403
   (`FORM_CLOSED`).

Migration: `packages/api/src/db/migrations/060_form_actions.sql`.
