# @sitesurge/client

## 0.2.4

### Patch Changes

- New `editor` role (content-editing staff): signs into the admin with a limited nav (no Plugins/Settings/Users/Mailing Lists/Shop), edits content via the new `staff` auth tier, and can be attributed as a post author. Post editor gains an Author dropdown (GET /users/authors); posts carry an authorId (defaults to the creator, reassignable, clearable). Migration 053 adds the enum value. Post-editor sticky header buttons match the Page editor size.
- Updated dependencies
  - @sitesurge/types@0.1.4

## 0.2.3

### Patch Changes

- Updated dependencies
  - @sitesurge/types@0.1.3

## 0.2.2

### Patch Changes

- Updated dependencies
  - @sitesurge/types@0.1.2
