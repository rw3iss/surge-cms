# Events — location, map and location label

This guide covers the location parts of an event. The rest of the Events
module (recurrence, registration, ticketing, access) is described in
`CLAUDE.md` → Core Capabilities → Events & calendar.

## Data

| Column (migration) | Meaning |
|---|---|
| `events.location` | The address text. Used for map lookups and for "View map". |
| `events.location_lat` / `location_lng` (199) | The map point. Both or neither. lat ±90, lng ±180. |
| `events.show_map` (199) | Draw a map on the event page. Has effect only with a point (`EventRecord.showMap`). |
| `events.location_label` (200) | Text shown INSTEAD of the address everywhere it is displayed. |

`eventLocationText(e)` (`@sitesurge/types` `utils/mapLink.ts`) is the ONE rule
for displayed text: label, else location. Event page, cards (web, SSR, email
via `EventRecord.locationText`), calendar list, ticket page, event emails and
JSON-LD (Place `name` = label, `address` = location) all use it. Maps and
"View map" always use the address + point (`mapLinkFor`: point, else the text).

## Editor (Event modal → Location)

- **Pick on map** opens the picker. It searches the typed text when it opens
  and when the text is committed. Other matches show as chips.
- Dragging the pin, clicking the map, or pressing **Enter** on the focused map
  (drops the pin at the map center) sets the point. A reverse lookup fills the
  text, else the coordinates. Picked points are wrapped to -180…180.
- **Show a map on the event page** is always available. Turning it on, or
  committing a new address while it is on, looks the address up in the
  background. No match → an amber "Couldn't locate…" warning (shown also when
  the panel is closed), cleared when a point is set.
- Only the LATEST lookup applies its result. Choosing a match, dragging or
  clearing the pin cancels lookups that are still running.
- **Save waits** for a running lookup (button reads "Locating…", at most
  10 s), so the saved point matches the saved address.
- **Set text** shows the Location label field.

## Server

- `mapPointFor` (`services/events/crud.ts`) fills a missing point on save for
  a map-on event with an address. Best-effort: it waits at most 5 s and never
  fails a save.
- A `PUT` that changes `location` without sending a point drops the old point
  (`pointAfterLocationChange`), so API / MCP edits cannot leave the map on the
  old place. The editor always sends the point.

## Geo lookups (`services/geo.ts`, `/api/v1/geo/search|reverse`)

- Staff tier + permission `geo:lookup`. SDK `cms.geo`.
- OpenStreetMap Nominatim, proxied with the site User-Agent. Searches run only
  on commit (no autocomplete — Nominatim policy).
- Serialized: 1 request/s per process. At most 20 lookups wait in the queue;
  more get **503 `GEO_BUSY`**. Identical lookups in flight share one upstream
  call. A non-JSON upstream answer → **502 `GEO_UNAVAILABLE`**.
- Cache (`CACHE_KEYS.geoSearch` / `geoReverse`): results 7 days, "not found"
  1 day. A cached reverse result always returns the CALLER's point.
- Known limit: the 1 request/s gate is per process. With `CLUSTER_WORKERS > 1`
  the site may exceed Nominatim's 1 request/s. Staff volume is small; a
  Redis-backed gate is planned.

## Map component (`components/map/LocationMap.tsx`)

- Leaflet + OSM tiles (`tile.openstreetmap.org`). JS and CSS load in a lazy
  chunk, only where a map renders, inside a local Suspense boundary with a
  same-height placeholder.
- Event page: a small map at the top of the aside when `showMap`. It is a
  keyboard-reachable link (Enter/Space) that opens Google Maps.
- This component is the provider seam — swap map providers here.
