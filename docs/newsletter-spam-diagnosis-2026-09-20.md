# Why the newsletters land in spam — diagnosis

**Date:** 2026-09-20
**Sending domain:** `lists.surgemedia.us` (bulk) · `mail.surgemedia.us` (transactional)

---

## Summary

**It is not DNS authentication.** SPF, DKIM and DMARC are all correctly
published and resolving for all three domains — that was the obvious suspect
and it checks out clean.

The most likely cause is a **broken one-click unsubscribe**. Every newsletter
advertises RFC 8058 one-click unsubscribe, and the URL it points at returns
**HTTP 403** to the POST that mailbox providers send. Gmail and Yahoo have
required working one-click unsubscribe from bulk senders since February 2024.
Advertising it and then failing it is worse than not advertising it: recipients
who click "Unsubscribe" in Gmail get nothing, so they press **Report spam**
instead — which is the single fastest way to poison a sending domain.

Three secondary factors compound it, all fixable in the codebase.

---

## 1. What is CORRECT (ruled out)

| Check | `surgemedia.us` | `mail.surgemedia.us` | `lists.surgemedia.us` |
|---|---|---|---|
| SPF | `include:_spf.google.com ~all` | `include:amazonses.com ~all` | `include:amazonses.com ~all` |
| DKIM (SES, 3 CNAMEs) | present | present | present |
| DKIM resolves | ✓ | ✓ | ✓ |
| DKIM records DNS-only (not CF-proxied) | ✓ | ✓ | ✓ |
| DMARC | `p=none` + rua | `p=none` + rua | `p=none` + rua |

Bulk mail is correctly split onto its own subdomain (`lists.`) so a newsletter
complaint can't poison password resets — that part of the setup is right.

**Note:** an earlier working note claimed "SES DKIM still missing". That is
**stale** — the records are there and resolving. Corrected below in §6.

---

## 2. PRIMARY: one-click unsubscribe is advertised but returns 403

**Evidence.**

```
POST https://surgemedia.us/u/<token>
→ 403  {"error":{"code":"CSRF_ERROR","message":"Invalid CSRF token"}}

GET  https://surgemedia.us/u/<token>
→ 400  (route exists, GET only)
```

Every send sets these headers (`services/mail/sendWorker.ts`):

```
List-Unsubscribe: <https://surgemedia.us/u/TOKEN>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

`List-Unsubscribe-Post` is a **promise to the mailbox provider** that a POST to
that URL will unsubscribe the recipient. But `routes/unsubscribe.ts` only
defines `method: 'get'`, and the CSRF middleware rejects the POST outright —
`/u/` is not in its exempt list (only `/assets/`, `/uploads/`, `/avatars/` and
`/shop/webhooks/` are).

**Why this drives spam placement.** Gmail's bulk sender requirements mandate
one-click unsubscribe and that it be honoured within two days. A sender that
advertises it and fails the POST is non-compliant. Worse, the user-visible
consequence is a dead Unsubscribe button — and the documented user response to
a dead unsubscribe is to report the message as spam. Gmail's threshold is a
**0.3% spam-complaint rate**; a handful of reports on a small list crosses it
easily, and once the domain is flagged everything lands in spam, which is
exactly the symptom.

**Fix.** Add `method: 'post'` for `/u/:token` (same handler, returns 200) and
exempt `/u/` from CSRF — a mailbox provider cannot carry a CSRF token, which is
the same reason `/shop/webhooks/` is already exempt. Also add a `mailto:`
alternative to `List-Unsubscribe`, which some providers prefer.

---

## 3. SECONDARY: every email is HTML-only, with no plain-text part

`OutboundMessage` (`@sitesurge/types`) has no `text` field, and the SMTP
provider calls `sendMail({ from, to, subject, html, replyTo, headers })` —
**no `text`**. So every newsletter is a single `text/html` part.

HTML-only bulk mail is a long-standing spam signal (SpamAssassin scores it via
`MIME_HTML_ONLY`), and the absence of a text alternative also degrades
rendering in clients and previews that prefer plain text.

**Fix.** Generate a plain-text alternative from the rendered HTML and pass it as
`text`, making the message `multipart/alternative`. The block renderers already
produce structured HTML, so a reasonable text version is derivable.

---

## 4. SECONDARY: article links in emails are RELATIVE, so they are dead

The rendered email contains:

```
href="/posts/saveourcities"      ← relative: resolves to nothing in an inbox
href="https://www.youtube.com/…" ← absolute: fine
```

The entity template authors the link as `/posts/{{post.slug}}`, which is correct
for a web page and broken in email — there is no base URL in a mail client.

This is both a functional bug (the main call-to-action does nothing) and a
deliverability factor: a newsletter whose primary link is dead generates no
engagement, and engagement is a ranking input.

**Fix.** Absolutise `href`/`src` against the site URL in the mail render pass —
the same treatment `buildSiteVariables` already applies to `site.logo`.

---

## 5. CONTRIBUTING: content and infrastructure signals

- **Thin text, image-led layout.** The sample newsletter renders **78 visible
  words** against 2 large images. A low text-to-image ratio is a classic bulk
  filter trigger. More real copy per send helps.
- **Images served from `cdn.ryanweiss.net`.** That domain has no relationship
  to `surgemedia.us` — no shared branding, no reputation history, and it reads
  as a personal domain. Filters do consider whether embedded resources align
  with the sending domain. Serving newsletter images from
  `surgemedia.us`/`cdn.surgemedia.us` would remove the mismatch.
- **`lists.surgemedia.us` has no MX record.** Mail sent *from*
  `newsletter@lists.surgemedia.us` cannot receive a reply — replies bounce.
  Some filters penalise a From domain that can't accept mail, and it is poor
  practice regardless. Either add an MX, or set **Reply-To** to a real mailbox
  (the new Settings → Mailing Lists → Reply-to field now does this).
- **Sending through SES *Mail Manager*, not standard SES.** `SMTP_HOST` is
  `…mail-manager-smtp.amazonaws.com`, whereas the normal outbound endpoint is
  `email-smtp.<region>.amazonaws.com`. Mail Manager is an ingress/routing
  product. **This needs verification** (see §7) — if that path does not apply
  the domain's DKIM signature, DKIM would fail at the receiver *despite* the
  DNS being perfect, and that alone would explain everything.
- **DMARC is `p=none`.** Not a spam cause, but it means no enforcement and
  little reputation benefit. Move to `p=quarantine` only after confirming
  alignment from the reports already going to `dmarc@surgemedia.us`.

---

## 6. Correction to a prior note

An earlier working note recorded "pending SES domain-identity DKIM verify / SES
DKIM still missing". That is no longer true: all three domains have their three
SES Easy-DKIM CNAMEs published, DNS-only, and resolving. Whether SES is
*applying* those signatures on the Mail Manager send path is the open question
in §7 — that is a different thing from the records being absent.

---

## 7. The one thing I cannot check — please get this

Everything above is inferred from configuration. The decisive evidence is in a
**received message's raw headers**, which only you can pull.

In Gmail, open a newsletter that landed in spam → **⋮ → Show original**. Look at
the top block:

```
SPF:   PASS with IP …
DKIM:  'PASS' with domain lists.surgemedia.us      ← must say PASS
DMARC: 'PASS'
```

Then copy me:
- those three lines,
- the `Authentication-Results:` header in full,
- the `List-Unsubscribe` and `List-Unsubscribe-Post` headers,
- any `X-Spam-Status` / `X-Spam-Score` header if present.

If **DKIM does not say PASS for `lists.surgemedia.us`**, that is the root cause
and §2–§5 are secondary. If it says PASS, then §2 (the dead unsubscribe) is the
leading explanation and should be fixed first.

---

## Recommended order

1. **Fix one-click unsubscribe** (POST route + CSRF exemption + `mailto:`). Highest impact, ~30 minutes, and it is a compliance requirement, not an optimisation.
2. **Send a plain-text alternative.** Removes a standing spam score on every message.
3. **Absolutise email links.** Fixes a dead call-to-action.
4. **Pull the raw headers** (§7) and confirm DKIM actually passes.
5. Move newsletter images onto a surgemedia.us host; set a real Reply-To; write more body copy.
6. Once reports look clean, tighten DMARC to `p=quarantine`.

Items 1–3 are code changes in this repo and I can make them. Item 4 needs you.
