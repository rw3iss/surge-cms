# GiveButter Donations plugin

Routes a campaign's donations through [GiveButter](https://givebutter.com) instead
of the built-in Stripe flow. The choice is **per-campaign**: each campaign editor
(when the plugin is enabled) gets a *Donations* panel where an admin picks
**Internal (Stripe)** or **GiveButter**. GiveButter campaigns render GiveButter's
embedded donation widget on the public site; donations go straight to GiveButter.

Plugin dir: `packages/api/plugins/givebutter/`. Modeled on the PageLoop plugin
(`docs/how-it-works/PLUGINS.md`), plus a generic **plugin action-RPC** (below) it relies on.

## What it adds

- **Config page** (`client.js` `mountConfig`) — API key, Widget Account ID, API
  base URL, default widget type; **Save**, **Test connection**, **List campaigns**.
- **Backend actions** (`server.js` `actions`, invoked via
  `POST /api/v1/plugins/givebutter/action/:action`, admin-only):
  `testConnection`, `listCampaigns`, `getCampaign`, `createCampaign`,
  `updateCampaign`, `deleteCampaign`, `checkCampaign`. All use the secret `apiKey`
  (never sent to the browser) and return a normalized `{ ok, ... }` /
  `{ ok:false, status, error }` envelope.
- **Campaign columns** (core, nullable, inert without the plugin): `donation_provider`
  (`'internal'|'givebutter'`), `givebutter_campaign_id`, `givebutter_campaign_code`
  (migration `058`). The public campaign payload carries the widget `code` so the
  block/page can render the widget with no extra endpoint.
- **Public rendering** — `components/blocks/GiveButterWidget.tsx` loads
  `https://widgets.givebutter.com/latest.umd.cjs?acct=<accountId>` once and renders
  `<givebutter-giving-form campaign="<code>">`. Used by `pages/Campaign.tsx` (in
  place of `DonationForm`) and the `campaign` content block (inline under the card).

## GiveButter API (reference)

- Base `https://api.givebutter.com/v1`, `Authorization: Bearer <apiKey>`, JSON.
- `GET /campaigns?page=&scope=owned|beneficiary|chapter`, `GET /campaigns/{id}`,
  `POST /campaigns` `{ title, type:'standard'|'event'|'sweepstakes'|'p2p', goal?(cents), description?, end_at? }`,
  `PATCH /campaigns/{id}`, `DELETE /campaigns/{id}`.
- Campaign object → numeric `id`, 6-char **`code`** (widgets), `title`, `goal`,
  `raised`, `donors`, `url`, `status`, `currency`, `end_at`.
- Widgets: library script keyed by **Account ID** + a `<givebutter-*>` element
  keyed by the campaign **code**. Params: `amount`, `frequency`, `fund`, `promo`.

## Configure + use

1. Enable the **Plugins** feature, then Admin → **Plugins** → install + enable
   **GiveButter**. Open its config page → set **API key** (GiveButter → Settings →
   API) + **Widget Account ID** (Settings → Integrations → Widgets) → **Test
   connection**.
2. Open a **Campaign** editor → *Donations* panel → provider **GiveButter** →
   either **link** an existing GiveButter campaign (Load campaigns / paste its
   6-char code) or **create** a new one on save. A warning shows until a campaign
   is linked. Save.
3. The public campaign page and any single-campaign `campaign` block now render the
   GiveButter donation widget.

## Notes / future work

- **Totals:** GiveButter collects donations client-side, so our
  `current_amount_cents`/`donorCount` don't reflect GiveButter donations. Syncing
  totals back via GiveButter **webhooks** (and showing GiveButter's own `raised`/goal
  via `getCampaign`/`goal-bar`) is future work.
- **Delete:** the `deleteCampaign` action exists but isn't wired to a destructive
  admin button in v1.
- Reference only (not a dependency): `github.com/johnnylinsf/givebutter-mcp`.
