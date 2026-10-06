# Amazon SES setup — full runbook (new AWS account)

**Context:** the previous AWS account is lost. Everything SES-side starts from
zero, including reputation. This walks the whole path: identities, DKIM,
production access, a configuration set, and event webhooks back into the CMS.

**Split of work:** steps marked **YOU** need the AWS console. Steps marked **ME**
are DNS (I have the Cloudflare token) or code in this repo.

---

## Read this first — three things that bite

**1. A new account starts in the SES SANDBOX.** You can only send to addresses
you have personally verified, capped at 200 messages/day and 1/second. Your
newsletter will not send to your list until AWS grants production access. Request
it EARLY (step 5) — approval is usually hours but can take a day, and it is the
long pole in this whole process.

**2. Every DKIM record currently in DNS is dead.** DKIM tokens are issued per
account. The nine `*._domainkey.*` CNAMEs in Cloudflare belong to the old
account and authenticate nothing now. They must be replaced with the new
account's tokens, not added alongside. I'll do the swap once you give me the new
values.

**3. Your sending reputation is gone and starts at zero.** A brand-new SES
identity has no history. Sending several thousand messages on day one from a
cold identity is a reliable way to get throttled, or to have receivers treat the
burst as suspicious — which is the exact problem we have been trying to fix.
Warm up: a few dozen on day one, a few hundred on day two, roughly double daily.
See step 11.

---

## Step 1 — Pick the region, and keep it. **YOU**

The old setup was **us-east-2 (Ohio)**. Use the same one unless you have a
reason not to. It keeps the MX/feedback hostnames identical to what is already
in DNS and avoids a second round of changes.

Everything below must happen in the SAME region. SES identities, configuration
sets and SMTP credentials are all regional — a common way to lose an hour is to
verify a domain in one region and create credentials in another.

---

## Step 2 — Verify the domain identities. **YOU** → then **ME**

SES console → **Identities** → *Create identity* → **Domain**.

Create **three**, in this order:

| Identity | Why |
|---|---|
| `surgemedia.us` | the root brand; also lets you send as `@surgemedia.us` later |
| `mail.surgemedia.us` | transactional (`EMAIL_FROM`) |
| `lists.surgemedia.us` | bulk newsletter (`MAIL_LIST_FROM`) |

For each one:
- **Enable Easy DKIM**, RSA_2048_BIT.
- **Uncheck** "Publish DNS records to Route53" (we are on Cloudflare).
- Leave "Use a custom MAIL FROM domain" for step 3.

SES will show **three CNAME records per identity** — nine in total. Copy them
all and send them to me; I'll replace the dead ones in Cloudflare in a single
pass. **They must be DNS-only, not proxied** — an orange cloud on a
`_domainkey` record breaks DKIM silently, and I'll verify that after adding.

> Keeping bulk on its own subdomain is deliberate: a spam complaint about a
> newsletter then cannot damage the reputation that password resets and receipts
> depend on. Do not consolidate them.

---

## Step 3 — Custom MAIL FROM domain. **YOU** → then **ME**

On each of `mail.` and `lists.`: **Edit** → *Use a custom MAIL FROM domain*.

- For `mail.surgemedia.us` → MAIL FROM `mail.surgemedia.us`
- For `lists.surgemedia.us` → MAIL FROM `lists.surgemedia.us`
- Behaviour on MX failure: **Use default MAIL FROM domain** (fails soft rather
  than rejecting the send).

SES then asks for an **MX** and a **TXT (SPF)** per subdomain:

```
mail.surgemedia.us    MX   10 feedback-smtp.us-east-2.amazonses.com
mail.surgemedia.us    TXT  "v=spf1 include:amazonses.com ~all"
lists.surgemedia.us   MX   10 feedback-smtp.us-east-2.amazonses.com
lists.surgemedia.us   TXT  "v=spf1 include:amazonses.com ~all"
```

`mail.` already has both. **`lists.` is missing its MX** — that was the open
question from the spam diagnosis, and this answers it: the MX belongs here, as
part of custom MAIL FROM, and I'll add it as part of this step rather than as a
standalone guess.

This is what makes the bounce path align with your domain under DMARC, and it
is the single biggest authentication improvement available to you.

> It still does **not** make `newsletter@lists.surgemedia.us` able to receive a
> human reply — that address routes to SES feedback handling, not an inbox. Set
> a real **Reply-To** in Settings → Mailing Lists so replies reach you.

---

## Step 4 — DMARC. **ME** (already in place)

All three `_dmarc` records exist at `p=none` with reports going to
`dmarc@surgemedia.us`. Leave them at `p=none` until step 11 confirms alignment,
then tighten.

---

## Step 5 — Request production access. **YOU — DO THIS EARLY**

SES console → **Account dashboard** → *Request production access*.

- Mail type: **Marketing** (you send newsletters; saying Transactional and then
  sending bulk is how accounts get suspended)
- Website: `https://surgemedia.us`
- Use case: describe it honestly — an opt-in newsletter for a Philadelphia news
  outlet, subscribers sign up on the site, every message carries one-click
  unsubscribe, bounces and complaints are processed automatically via SNS.
- Confirm you handle bounces and complaints — after this runbook, you genuinely
  will, which matters because AWS checks.

Ask for a sending quota that fits your list with headroom.

---

## Step 6 — Create the configuration set. **YOU**

SES → **Configuration sets** → *Create set*.

- Name: **`surge-events`** (the code below expects this name; tell me if you use
  another and I'll change it)
- Reputation metrics: **enabled**
- Leave open/click tracking **off** for now — see the note in step 8.

---

## Step 7 — SNS topic + event destination. **YOU**

**a. Create the topic.** SNS → *Create topic* → **Standard** → name
`surge-ses-events`.

**b. Attach it to the configuration set.** SES → `surge-events` → **Event
destinations** → *Add destination*:

- Event types: **Send, Delivery, Bounce, Complaint, Reject, Rendering Failure**
  (add Open/Click only if you enable tracking later)
- Destination: **Amazon SNS** → `surge-ses-events`

**c. Subscribe the CMS.** SNS topic → *Create subscription*:

- Protocol: **HTTPS**
- Endpoint: `https://surgemedia.us/api/v1/mail/webhooks/ses`
- **Enable raw message delivery: OFF** (the handler verifies SNS's signature,
  which requires the full envelope)

SNS immediately POSTs a `SubscriptionConfirmation`. The endpoint confirms it
automatically, so the subscription should flip to *Confirmed* within seconds. If
it stays *Pending*, that is the first thing to debug.

---

## Step 8 — Open and click tracking (optional, read before enabling)

Enabling these in the configuration set makes SES rewrite every link through an
SES tracking domain and inject a 1×1 pixel.

**My recommendation: leave both off, at least initially.**

- **Open rates are largely fiction now.** Apple Mail Privacy Protection
  pre-fetches every image, so Apple users count as "opened" whether or not they
  looked. Gmail proxies images similarly. It is a loose trend line, not a
  measurement.
- **Link rewriting costs you something real.** Every link becomes an
  `awstrack.me` URL. That is another domain in the message with no relationship
  to your brand — the same mismatch I flagged about `cdn.ryanweiss.net` in the
  spam diagnosis — and some filters treat redirect wrappers as a negative.

**Delivery, bounce and complaint are the events that actually matter** and they
need none of this. If you later want click data, enable it with a custom
tracking subdomain (`click.surgemedia.us`) so the links stay on your brand.

---

## Step 9 — SMTP credentials. **YOU** → then **ME**

SES → **SMTP settings** → *Create SMTP credentials*. This makes an IAM user;
download the username and password **once** — they cannot be retrieved later.

Note the SMTP endpoint shown, which will be:

```
email-smtp.us-east-2.amazonaws.com    port 587    STARTTLS
```

**This is a change.** You are currently pointed at
`…mail-manager-smtp.amazonaws.com`, which is Mail Manager — an ingress/routing
product, not the standard outbound interface. That was my open question in the
spam diagnosis: whether DKIM was even being applied on that path. Moving to the
standard endpoint removes the uncertainty entirely and is the right thing
regardless.

Send me the credentials and I'll update the server's `.env`:

```
SMTP_HOST=email-smtp.us-east-2.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<new>
SMTP_PASS=<new>
```

> Send them over a channel you are comfortable with; they go into `.env` on the
> server, which is gitignored and never committed.

---

## Step 10 — The code side. **ME**

1. Send `X-SES-CONFIGURATION-SET: surge-events` on every outgoing message —
   without this header SES publishes no events at all, and everything above sits
   idle.
2. Add `POST /api/v1/mail/webhooks/ses`:
   - CSRF-exempt (SNS cannot carry a token) — same treatment as
     `/shop/webhooks/` and `/u/`
   - **verifies the SNS signature** against the certificate in the message,
     with the cert URL constrained to `*.amazonaws.com`; an unverified endpoint
     here is an open door to forged bounce events that would let anyone
     unsubscribe your list
   - auto-confirms `SubscriptionConfirmation`
3. Store events per recipient: `delivered`, `bounced`, `complained`, `rejected`.
4. **Auto-suppress** on hard bounce and on complaint — set the subscriber to
   `bounced` / `complained` so they are never mailed again. This is the part
   that protects your reputation, and the part AWS expects you to have.
5. Surface Delivered / Bounced / Complained on the job page next to Sent and
   Failed, so "did it arrive?" is answerable.

Say the word and I'll build 1–5; it does not depend on your AWS steps, and can
land before production access is granted.

---

## Step 11 — Verify, then warm up

Once the SMTP switch is in, send one message to yourself and check the raw
headers (Gmail → ⋮ → **Show original**):

```
SPF:   PASS   with domain lists.surgemedia.us
DKIM:  PASS   with domain lists.surgemedia.us      ← the one that matters
DMARC: PASS
```

This is the same check I asked for in the spam diagnosis, and it will finally
be conclusive.

Then warm up rather than blasting:

| Day | Volume |
|---|---|
| 1 | 50 |
| 2 | 100 |
| 3 | 250 |
| 4 | 500 |
| 5+ | roughly double daily, watching bounce and complaint rates |

Watch in SES → Account dashboard: **bounce rate under 5%**, **complaint rate
under 0.1%** (AWS warns at 5%/0.1% and suspends above; Gmail's own threshold is
0.3% complaints). With auto-suppression from step 10 these should stay low.

---

## Checklist

- [ ] Region chosen (us-east-2) — **YOU**
- [ ] Three domain identities created, Easy DKIM on — **YOU**
- [ ] Nine DKIM CNAMEs sent to me; old ones replaced — **YOU** → **ME**
- [ ] Custom MAIL FROM on `mail.` and `lists.`; `lists.` MX added — **YOU** → **ME**
- [ ] Production access requested — **YOU, do first**
- [ ] Configuration set `surge-events` created — **YOU**
- [ ] SNS topic + event destination + HTTPS subscription — **YOU**
- [ ] SMTP credentials created and sent to me — **YOU** → **ME**
- [ ] Config-set header + SNS webhook + suppression + UI — **ME**
- [ ] Raw-header check shows DKIM PASS — **YOU**
- [ ] Warm-up schedule started — **YOU**

---

## What I need from you, in one message

1. The **nine DKIM CNAME** name/value pairs (three per identity)
2. Confirmation of the **region** if it is not us-east-2
3. The **SMTP username and password**
4. The **configuration set name** if not `surge-events`

With those I can do the DNS swap, the `.env` update and the code in one pass.
