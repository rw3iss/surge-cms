# Component sources

Components (`/admin/components`) live in the database — they are
`content_block_templates` rows, edited in the admin and served from there.

The copies here are the **source of record for review**: a component's markup
and its client module are ordinary files that deserve diffs and history, and the
DB is not reviewable. They are not loaded at runtime and editing them changes
nothing on its own; push a change with the site's API (or paste it into the
component editor).

| File | Component | Site |
|---|---|---|
| `as-seen-on-ticker.{html,js}` | As Seen On Ticker | surgemedia.us |
| `merch-notification-tout.{html,js}` | Merch Notification Tout | surgemedia.us |
| `newsletter-signup-modal.{html,js}` | Newsletter Signup Modal | surgemedia.us |

The ticker never wraps, in any state — one row per label, always. There is no
wrapping mode to turn on.

`data-scroll` picks the behaviour: `auto` (default) scrolls only when the items
overflow the row, `always` scrolls regardless (a short list is repeated so the
loop stays continuous), `static` never animates. `data-justify` sets
justify-content for a STATIC row (`center`, `space-around`, …) — a scrolling
track is exactly as wide as its content, so there is no free space for it to
distribute. `data-speed="0"` also stops the animation.

### Split rows

Wrapping two `.asot__row`s in a `.asot__split` runs them side by side. Each half
stays a COMPLETE ticker — its own label, fades, and duration derived from its own
width at the shared px/sec. Nothing in the script knows splits exist: `.asot__row`
is already the positioning context for its label and fades, and every row is
measured on its own `clientWidth`, so a half behaves exactly like a full row.

Default is 50/50. Weight a half with `style="--asot-split-grow: 2"` (basis stays
0, so the grow factors set the ratio outright rather than dividing the leftover).
`data-split-min` sets the floor per half, default 250px.

Responsive behaviour is plain flexbox — `flex-wrap: wrap` plus that floor — so
the browser re-decides it on every resize without the script re-measuring. Below
768px the halves always stack, matching the site's own mobile breakpoint.

Spacing between stacked halves is the container's **`row-gap`**, never a
`.asot__row + .asot__row` margin: a `+` margin applies whether or not the second
row has wrapped, which put the right-hand ticker 6px lower than the left while
they sat side by side.

Current arrangement: **Stations | Publications** split across the top row, then
**Shows** full width beneath.

## As Seen On Ticker — logo assets

Four entries use real logos; the rest are the name as styled text.

| Entry | Asset | Source / status |
|---|---|---|
| Fox News | `bbvolvx-H5qT.svg` | Wikimedia Commons, PD-textlogo |
| Newsmax | `iY-Ho-4bcg7e.svg` | Wikimedia Commons, PD-textlogo |
| Real America's Voice | `xGumGw7KZ-6o.svg` | Wikimedia Commons, PD-textlogo |
| Blaze TV | `Lat50TvKo9nX.svg` | Wikimedia Commons, CC0 — **the TheBlaze/Blaze Media wordmark, not the BlazeTV lockup** |
| Newsmax 2 | `CX4oLmwlgyVe.png` | supplied by the operator; greyscaled and downscaled before upload |
| OAN | `CK3ZH84BPJN4.png` | supplied by the operator; greyscaled and downscaled before upload |
| Timcast | — | no freely-licensed mark found |
| all nine shows | — | show titles; most have no logo asset at all |

**PD-textlogo** means the mark is below the threshold of originality, so there
is no copyright in it. The trademarks remain their owners'; the strip states
where the site's work has appeared, which is what the marks are being used to
refer to. Greyscaling is a deliberate house style and is an alteration, so
check it against any brand guidelines that matter to you.

To add a logo later: upload it in Media, then in the ticker's HTML block swap
the entry's text for `<img class="asot__logo" src="<url>" alt="<name>">`, with
`style="--asot-logo-h: 30px"` if it needs to sit taller (stacked lockups do;
plain wordmarks want the 19px default).

**Prepare a raster logo before uploading.** The CSS greyscales at render time,
but a colour PNG still ships its colour channels to every visitor. Convert to
greyscale and downscale to ~4x the rendered height — flat graphics cost almost
nothing at that size (both of the PNGs above are ~10KB) and stay crisp on a
retina display. Greyscale is idempotent, so the render-time filter still lands
these at the same weight as the colour SVGs beside them:

```
sharp(src).grayscale().resize({ height: displayH * 4, fit: 'inside' })
          .png({ compressionLevel: 9, palette: true })
```

## Merch Notification Tout — it must not depend on the page behind it

The card is used on **two** pages with opposite backgrounds:

| Page | Page background | |
|---|---|---|
| `shop-coming-soon` | `swatch:brand-red` | what the card was designed for |
| `home` | none (white) | where it broke |

The card paints only `rgba(255,255,255,.08)` over a white 45% border, so it
relies on a red ancestor it cannot see. On the homepage the operator set the
instance's `textColor` to `#000` so the copy stayed readable — but the button's
colours are hardcoded in the component's own `<style>` and could not follow, so
a white-filled, white-bordered button sat on a white page.

It was invisible on both, and only *looked* fine on desktop because the compact
pill's box-shadow still read as a button. The `@media(max-width:768px)` rule
stretches the button to `width:100%`, which removes that silhouette and leaves
red text floating on white — so it was reported as a mobile bug.

The border is therefore `currentColor` (the button's own brand red), not `#fff`:
the button draws its own edge on any background. Keep it that way. If you give
the button a new colour, take the border with it — do not reintroduce a value
that only exists on one of the two pages.

## Newsletter Signup Modal — an invisible component

This one renders **nothing**. Its HTML block is a `<style>` plus a `display:none`
config carrier; the client module decides whether to ask the visitor to join a
list and portals a dialog into `<body>`. Place it in a block anywhere on the
page — the end is the conventional spot — and turn OFF default padding, or an
invisible component still takes vertical space.

### Who gets asked

Three independent suppressions, checked cheapest first:

| # | Signal | Scope | Expires |
|---|---|---|---|
| 1 | Signed up here | `localStorage`, this browser | never |
| 2 | Dismissed here | `localStorage`, this browser | after `dismissDays` (default 7) |
| 3 | Subscribed on the account | server, signed-in only | n/a |

The order is the point. (1) and (2) are synchronous reads, so a returning
visitor costs **no request at all**; (3) is the only signal that knows about a
subscription made on another device, and it is only answerable for someone
signed in. A positive (3) is written back into (1), so it is asked once per
browser rather than once per page view.

An anonymous visitor has no server-side identity, so `localStorage` is the only
signal they have — which is why signing up writes there immediately rather than
relying on a later lookup.

**Every close is a dismissal** — ×, "No thanks", `Escape`, and the backdrop all
record the same thing. There is deliberately no way to close it that leaves it
able to reappear on the next page view; from the visitor's side that is
indistinguishable from a bug.

**It never opens under `/admin`.** The component renders in the page editor's
block preview exactly as it does on the site, so without that guard the operator
gets a modal thrown over the editor every time they open the page holding it.

### Membership is not a public fact

The check calls `GET /lists/:slug/subscription`, which takes **no email** and
answers `false` for an anonymous caller — it reads the address from the session.
An endpoint that answered for an arbitrary address would let anyone test whether
a given person subscribes to a given list, which is the exact property the
shop's merchandise signup protects by answering identically for a new and an
existing address. If you extend this endpoint, keep it to *"am I on this
list?"*, never *"is this person on this list?"*.

### Configuration

Each value can be set on the **using block's settings** (which win) or as a
`data-` attribute in the component's HTML block, so one component can prompt for
a different list, or at a different delay, on another page.

| Block setting | Attribute | Default | |
|---|---|---|---|
| `listSlug` | `data-list` | `newsletter` | mailing list **slug** |
| `popupDelay` | `data-delay` | `2000` | ms after load before showing |
| `dismissDays` | `data-dismiss-days` | `7` | quiet period after a dismissal; **0 = ask again next page view** |
| `modalTitle` | `data-title` | Stay in the Loop | |
| `modalLede` | `data-lede` | … | paragraph under the heading |
| `submitLabel` | `data-submit-label` | Sign me up | |
| `dismissLabel` | `data-dismiss-label` | No thanks | |

A double-opt-in list gets a different success message ("check your inbox"),
because telling someone they are subscribed while a confirmation email sits
unclicked is how a list quietly stops growing.
