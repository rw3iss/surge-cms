# @sitesurge/server

## 0.1.11

### Patch Changes

- Set COOP to `same-origin-allow-popups` so cross-origin OAuth-popup sign-in flows for embedded third-party widgets (e.g. the PageLoop plugin) can postMessage the session token back to the opener. Helmet's default `same-origin` severed `window.opener`, silently breaking popup sign-in.
  - @sitesurge/admin@0.1.11

## 0.1.10

### Patch Changes

- New `editor` role (content-editing staff): signs into the admin with a limited nav (no Plugins/Settings/Users/Mailing Lists/Shop), edits content via the new `staff` auth tier, and can be attributed as a post author. Post editor gains an Author dropdown (GET /users/authors); posts carry an authorId (defaults to the creator, reassignable, clearable). Migration 053 adds the enum value. Post-editor sticky header buttons match the Page editor size.
- Updated dependencies
  - @sitesurge/admin@0.1.10
  - @sitesurge/types@0.1.4

## 0.1.9

### Patch Changes

- Updated dependencies
  - @sitesurge/admin@0.1.9

## 0.1.8

### Patch Changes

- Serve the HTML shell with Cache-Control: no-store so the per-plugin CSP header is never served stale from cache (a plugin widget could otherwise stay blocked on repeat visits). Hashed JS/CSS assets remain cacheable.
  - @sitesurge/admin@0.1.8

## 0.1.7

### Patch Changes

- CSP: allow Google Fonts stylesheets (style-src fonts.googleapis.com) so appearance-system fonts load instead of falling back.
  - @sitesurge/admin@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies
  - @sitesurge/admin@0.1.6

## 0.1.5

### Patch Changes

- Plugin-aware Content-Security-Policy: enabled plugins' widgets can reach their backend. connect-src is extended with each enabled plugin's type:'url' config origins, plus an optional manifest `csp` block (connect/script/style/img/frame). Fixes PageLoop being blocked from https://pageloop.dev.
- Updated dependencies
  - @sitesurge/types@0.1.3
  - @sitesurge/admin@0.1.5

## 0.1.4

### Patch Changes

- Real plugin marketplace: first-party plugins are bundled into the server (dist/plugins-catalog); marketplaceInstall copies a chosen plugin into the consumer's PLUGINS_DIR and runs the normal install lifecycle (replaces the 501 stub). Bundled catalog resolver + discoverCatalog in the plugin loader.
  - @sitesurge/admin@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies
  - @sitesurge/admin@0.1.3
  - @sitesurge/types@0.1.2
