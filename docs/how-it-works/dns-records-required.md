# surgemedia.us — DNS record state and what is still needed

Audited **2026-09-21** against live DNS. Everything below is either verified
present, or verified absent.

---

## 1. Already correct — do not touch

| Name | Type | Value | Purpose |
|---|---|---|---|
| `surgemedia.us` | MX | `1 smtp.google.com` | Google Workspace **receives** all mail |
| `surgemedia.us` | TXT | `v=spf1 include:_spf.google.com ~all` | authorises Google to send as the apex |
| `google._domainkey.surgemedia.us` | TXT | `v=DKIM1; k=rsa; p=MIIBIjAN…` | Google Workspace DKIM |
| `mail.surgemedia.us` | MX | `10 feedback-smtp.us-east-2.amazonses.com` | SES custom MAIL FROM (transactional) |
| `mail.surgemedia.us` | TXT | `v=spf1 include:amazonses.com ~all` | authorises SES for the transactional subdomain |
| `lists.surgemedia.us` | TXT | `v=spf1 include:amazonses.com ~all` | authorises SES for the bulk subdomain |
| `_dmarc.surgemedia.us` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@surgemedia.us; fo=1` | reporting only, for now |
| `_dmarc.mail.surgemedia.us` | TXT | same | |
| `_dmarc.lists.surgemedia.us` | TXT | same | |

> **Receiving and sending are separate.** Google holds the apex MX and must keep
> it. The `mail.` / `lists.` MX records are NOT for receiving — they are SES's
> bounce-and-complaint path, required by custom MAIL FROM.

---

## 2. Missing — exact values known, can be added now

| Name | Type | Value | TTL |
|---|---|---|---|
| `lists.surgemedia.us` | **MX** | `10 feedback-smtp.<REGION>.amazonses.com` | Auto |

`mail.` has this; `lists.` does not. It completes custom MAIL FROM for the bulk
subdomain, which is what aligns the bounce path with your domain under DMARC.

**`<REGION>` must match the new SES account's region.** The existing `mail.`
record says `us-east-2`, but that was written for the *old* account. If the new
one is elsewhere, BOTH records change.

---

## 3. Missing — values only SES can give you

**Six CNAMEs: three per sending domain.** DKIM tokens are generated per account
and cannot be derived, guessed, or reused from the old account. **Every DKIM
record currently in DNS for these subdomains is dead** — it belongs to the lost
account and authenticates nothing.

Get them: SES console → **Identities** → pick the domain → **DKIM** panel, or

```bash
aws sesv2 get-email-identity --email-identity mail.surgemedia.us  --region <REGION>
aws sesv2 get-email-identity --email-identity lists.surgemedia.us --region <REGION>
```

They arrive in this shape (the `xxxx` are 32-char tokens unique to you):

| Name | Type | Value |
|---|---|---|
| `xxxx1._domainkey.mail.surgemedia.us` | CNAME | `xxxx1.dkim.amazonses.com` |
| `xxxx2._domainkey.mail.surgemedia.us` | CNAME | `xxxx2.dkim.amazonses.com` |
| `xxxx3._domainkey.mail.surgemedia.us` | CNAME | `xxxx3.dkim.amazonses.com` |
| `yyyy1._domainkey.lists.surgemedia.us` | CNAME | `yyyy1.dkim.amazonses.com` |
| `yyyy2._domainkey.lists.surgemedia.us` | CNAME | `yyyy2.dkim.amazonses.com` |
| `yyyy3._domainkey.lists.surgemedia.us` | CNAME | `yyyy3.dkim.amazonses.com` |

**All six must be DNS-only — grey cloud, not orange.** A proxied `_domainkey`
record breaks DKIM silently: mail still sends, and simply fails authentication.

> This is the single highest-value item on the page. Until it is done, DMARC for
> everything you send rests on SPF alone, and SPF breaks whenever a recipient's
> server forwards the message.

---

## 4. Later — DMARC enforcement (required for BIMI)

Only after §3 is in place **and** a week of DMARC reports shows SPF **and** DKIM
passing. Enforcing while DKIM is absent can quarantine legitimate mail.

| Name | Type | Value |
|---|---|---|
| `_dmarc.surgemedia.us` | TXT | `v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@surgemedia.us; fo=1` |
| `_dmarc.mail.surgemedia.us` | TXT | same |
| `_dmarc.lists.surgemedia.us` | TXT | same |

---

## 5. Blocked — BIMI

| Name | Type | Value |
|---|---|---|
| `default._bimi.surgemedia.us` | TXT | `v=BIMI1; l=https://…/surge-bimi.svg; a=https://…/surge.pem` |
| `default._bimi.lists.surgemedia.us` | TXT | same |

**Do not add these yet.** Gmail ignores a BIMI record without a certificate, and
neither certificate is obtainable today:

- **CMC** needs 12 months of continuous public logo use. Domain registered
  **2025-12-11**, first archived **2026-01-07** → earliest ≈ **January 2027**.
- **VMC** needs a registered trademark (8–12 months at the USPTO).

The compliant logo is ready at `/home/rw3iss/surge-bimi.svg` — the site's own
SVG would be rejected, as SVG P/S forbids the `<style>` block and CSS classes it
uses.

---

## 6. Housekeeping

- `surgemedia.us` TXT contains a stray `"rp.mta01.mailhawk.io"` — a leftover
  verification string from a provider no longer in use. Harmless; remove it when
  convenient.
- The apex SPF authorises Google only. That is correct **while** all SES mail
  sends from `mail.` or `lists.` (it does: `EMAIL_FROM` and `MAIL_LIST_FROM`).
  If anything is ever sent as `@surgemedia.us` through SES, the apex SPF needs
  `include:amazonses.com` too.

---

## Not DNS, but on the same critical path

`SMTP_HOST` on the server is still
`…fips.yxbq.mail-manager-smtp.amazonaws.com` — **Mail Manager**, an
ingress/routing product, not the standard outbound SES interface. It should be
`email-smtp.<REGION>.amazonaws.com` on port 587. Until it is, whether DKIM is
applied on the send path at all is unverified, and §3 may not take effect even
once the records exist.
