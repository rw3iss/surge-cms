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
