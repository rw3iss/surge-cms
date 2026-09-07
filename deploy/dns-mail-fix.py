#!/usr/bin/env python3
"""
Assert the correct mail DNS for surgemedia.us in Cloudflare.

WHY THIS EXISTS: the domain accumulated records from three previous mail setups
(Cloudflare Email Routing, MailHawk, dnssmarthost) on top of the current one
(Google Workspace for receiving + Amazon SES for sending). The leftovers are not
merely untidy — a second `v=DMARC1` record makes DMARC count as ABSENT, and an
MX value stored as a TXT record does nothing at all. This script states the
intended end state as data and makes the zone match it.

Idempotent: run it twice and the second run reports no changes.

Usage:
    export CLOUDFLARE_API_TOKEN=...        # scope: Zone → DNS → Edit
    python3 deploy/dns-mail-fix.py         # DRY RUN — prints the plan, changes nothing
    python3 deploy/dns-mail-fix.py --apply # applies it

    # DKIM tokens come from SES (see --dkim below); without them the script
    # simply skips DKIM and tells you so.
    python3 deploy/dns-mail-fix.py --dkim mail.surgemedia.us=tok1,tok2,tok3 --apply

DNS propagation: Cloudflare serves changes within seconds, but resolvers cache
for the record's TTL. These are written with TTL 300 (5 min) so a mistake is
cheap to undo.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
ZONE = "surgemedia.us"

# The SES region is read off the existing MAIL FROM record, NOT assumed: the
# feedback-smtp host must match the region the identity actually lives in.
SES_REGION = "us-east-2"

# ── Desired state ────────────────────────────────────────────────────────────
# `keep`   — the record must exist with exactly this content (created/updated).
# `remove` — the record must NOT exist (matched on type + name + content).

KEEP = [
    # ONE DMARC record. Two of them means DMARC is ignored entirely (RFC 7489
    # §6.6.3), which is the state the zone is in today.
    dict(type="TXT", name="_dmarc.surgemedia.us",
         content="v=DMARC1; p=none; rua=mailto:dmarc@surgemedia.us; fo=1"),

    # SES custom MAIL FROM for transactional mail (EMAIL_FROM=@mail.surgemedia.us).
    # This has to be an MX record; today the same value sits in a TXT, where
    # nothing reads it.
    dict(type="MX", name="mail.surgemedia.us",
         content=f"feedback-smtp.{SES_REGION}.amazonses.com", priority=10),
    dict(type="TXT", name="mail.surgemedia.us",
         content="v=spf1 include:amazonses.com ~all"),

    # Bulk mail (MAIL_LIST_FROM=@lists.surgemedia.us). The current value still
    # authorises Cloudflare Email Routing, which no longer sends anything, and
    # does not authorise SES, which does.
    dict(type="TXT", name="lists.surgemedia.us",
         content="v=spf1 include:amazonses.com ~all"),

    # Apex sends only via Google Workspace. Dropping the dead Cloudflare include
    # also buys back one of SPF's 10 permitted DNS lookups.
    dict(type="TXT", name="surgemedia.us",
         content="v=spf1 include:_spf.google.com ~all"),
]

REMOVE = [
    # Second DMARC record — its presence is what breaks DMARC.
    dict(type="TXT", name="_dmarc.surgemedia.us", content="v=DMARC1; p=none;"),
    # An SPF record published at _dmarc. Wrong name; means nothing there.
    dict(type="TXT", name="_dmarc.surgemedia.us",
         content="v=spf1 +a +mx include:surgemedia.us.spf.auto.dnssmarthost.net "
                 "include:spf.mta01.mailhawk.io ~all"),
    # The MX value stranded in a TXT record. The MX above replaces it.
    dict(type="TXT", name="mail.surgemedia.us",
         content=f"10 feedback-smtp.{SES_REGION}.amazonses.com"),
    # Double-suffixed hostname: someone typed the FQDN into Cloudflare's name
    # field, which appends the zone. Nobody intends `x.surgemedia.us.surgemedia.us`,
    # and the correctly-named record already exists beside it.
    dict(type="TXT", name="lists.surgemedia.us.surgemedia.us",
         content="v=spf1 include:_spf.mx.cloudflare.net ~all"),
]

# Dead but harmless leftovers. NOT removed by default — each is opt-in, because
# "looks unused" is not the same as "is unused" when the cost of being wrong is
# mail silently failing.
OPTIONAL_REMOVALS = {
    # Cloudflare Email Routing's DKIM key. Dead since MX moved to Google.
    "cf-dkim": dict(type="TXT", name="cf2024-1._domainkey.surgemedia.us", content=None),
    # Bare apex TXT from MailHawk; matches no standard.
    "mailhawk": dict(type="TXT", name="surgemedia.us", content="rp.mta01.mailhawk.io"),
}



def api(token, method, path, body=None):
    req = urllib.request.Request(
        f"{API}{path}", method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        sys.exit(f"Cloudflare API {e.code} on {method} {path}\n{detail}")


def norm(s):
    """TXT values come back with surrounding quotes inconsistently."""
    return s.strip().strip('"')


def matches(rec, want):
    if rec["type"] != want["type"] or rec["name"] != want["name"]:
        return False
    # content=None means "whatever the value, this name+type shouldn't exist".
    if want.get("content") is None:
        return True
    return norm(rec["content"]) == norm(want["content"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually make the changes")
    ap.add_argument("--also-drop", action="append", default=[], metavar="KEY",
                    choices=list(OPTIONAL_REMOVALS),
                    help=f"delete an opt-in leftover: {', '.join(OPTIONAL_REMOVALS)}")
    ap.add_argument("--dkim", action="append", default=[], metavar="DOMAIN=t1,t2,t3",
                    help="SES DKIM tokens; repeatable. Get them with: "
                         "aws sesv2 get-email-identity --email-identity <domain> "
                         f"--region {SES_REGION}")
    args = ap.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        sys.exit("CLOUDFLARE_API_TOKEN is not set. Create one at\n"
                 "  Cloudflare → My Profile → API Tokens → Create Token\n"
                 "  Template 'Edit zone DNS', Zone Resources = surgemedia.us")

    keep = list(KEEP)
    for spec in args.dkim:
        domain, _, toks = spec.partition("=")
        for t in [t.strip() for t in toks.split(",") if t.strip()]:
            keep.append(dict(type="CNAME", name=f"{t}._domainkey.{domain}",
                             content=f"{t}.dkim.amazonses.com", proxied=False))

    remove = list(REMOVE) + [OPTIONAL_REMOVALS[k] for k in args.also_drop]

    zones = api(token, "GET", f"/zones?name={ZONE}")["result"]
    if not zones:
        sys.exit(f"No zone {ZONE} on this token. Check the token's Zone Resources.")
    zid = zones[0]["id"]

    existing = api(token, "GET", f"/zones/{zid}/dns_records?per_page=200")["result"]
    plan = []

    for want in remove:
        for rec in existing:
            if matches(rec, want):
                plan.append(("DELETE", rec["id"], want, rec))

    for want in keep:
        same = [r for r in existing if matches(r, want)]
        if same:
            continue
        # Same type+name but different content → UPDATE, so we replace the value
        # rather than publishing a second record beside it. That distinction is
        # the whole point for SPF and DMARC, where two records is a failure.
        sibling = next(
            (r for r in existing
             if r["type"] == want["type"] and r["name"] == want["name"]
             and not any(matches(r, k) for k in keep if k is not want)
             and not any(matches(r, rm) for rm in remove)),
            None,
        )
        plan.append(("UPDATE", sibling["id"], want, sibling) if sibling
                    else ("CREATE", None, want, None))

    if not plan:
        print("✓ DNS already matches the intended state — nothing to do.")
        return

    print(f"{'PLAN' if not args.apply else 'APPLYING'} — {len(plan)} change(s) to {ZONE}\n")
    for action, _id, want, rec in plan:
        print(f"  {action:<6} {want['type']:<5} {want['name']}")
        if action == "DELETE":
            print(f"         was: {norm(rec['content'])}")
        else:
            if rec:
                print(f"         was: {norm(rec['content'])}")
            print(f"         now: {norm(want['content'])}")

    if not any(k["type"] == "CNAME" for k in keep):
        print("\n  ! No DKIM CNAMEs supplied — see --dkim. Without DKIM, DMARC")
        print("    can only pass via SPF alignment, so it stays fragile.")

    if not args.apply:
        print("\nDry run. Re-run with --apply to make these changes.")
        return

    for action, rid, want, _rec in plan:
        body = {k: v for k, v in want.items() if k != "proxied"}
        body["ttl"] = 300
        if want["type"] == "CNAME":
            body["proxied"] = False
        if action == "DELETE":
            api(token, "DELETE", f"/zones/{zid}/dns_records/{rid}")
        elif action == "UPDATE":
            api(token, "PUT", f"/zones/{zid}/dns_records/{rid}", body)
        else:
            api(token, "POST", f"/zones/{zid}/dns_records", body)
        print(f"  ✓ {action} {want['type']} {want['name']}")

    print("\nDone. Verify in ~5 minutes (TTL 300):")
    print("  dig +short TXT _dmarc.surgemedia.us   # exactly ONE v=DMARC1 line")
    print("  dig +short MX  mail.surgemedia.us")
    print("  dig +short TXT mail.surgemedia.us lists.surgemedia.us")


if __name__ == "__main__":
    main()
