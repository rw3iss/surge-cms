# @sitesurge/server

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
