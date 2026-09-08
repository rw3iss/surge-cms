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
