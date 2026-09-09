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

The ticker never wraps, in any state — one row per label, always. There is no
wrapping mode to turn on.

`data-scroll` picks the behaviour: `auto` (default) scrolls only when the items
overflow the row, `always` scrolls regardless (a short list is repeated so the
loop stays continuous), `static` never animates. `data-justify` sets
justify-content for a STATIC row (`center`, `space-around`, …) — a scrolling
track is exactly as wide as its content, so there is no free space for it to
distribute. `data-speed="0"` also stops the animation.

## As Seen On Ticker — logo assets

Four entries use real logos; the rest are the name as styled text.

| Entry | Asset | Source / status |
|---|---|---|
| Fox News | `bbvolvx-H5qT.svg` | Wikimedia Commons, PD-textlogo |
| Newsmax | `iY-Ho-4bcg7e.svg` | Wikimedia Commons, PD-textlogo |
| Real America's Voice | `xGumGw7KZ-6o.svg` | Wikimedia Commons, PD-textlogo |
| Blaze TV | `Lat50TvKo9nX.svg` | Wikimedia Commons, CC0 — **the TheBlaze/Blaze Media wordmark, not the BlazeTV lockup** |
| Newsmax 2, OAN, Timcast | — | no freely-licensed mark found |
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
