# @sitesurge/admin

## 0.1.11

## 0.1.10

### Patch Changes

- New `editor` role (content-editing staff): signs into the admin with a limited nav (no Plugins/Settings/Users/Mailing Lists/Shop), edits content via the new `staff` auth tier, and can be attributed as a post author. Post editor gains an Author dropdown (GET /users/authors); posts carry an authorId (defaults to the creator, reassignable, clearable). Migration 053 adds the enum value. Post-editor sticky header buttons match the Page editor size.

## 0.1.9

### Patch Changes

- Admin editor polish: sticky Post/Page editor header that never squashes the action buttons on long titles; carousel titles use container-query sizing (smaller + responsive, shrink to fit the slide/post area); removed the redundant Preview from the Carousel block editor; standardized text inputs across block-edit panels.

## 0.1.8

## 0.1.7

## 0.1.6

### Patch Changes

- PWA: serve the SPA shell NetworkFirst instead of from the precache navigation fallback, so server response headers (notably a plugin-extended CSP) always reach the browser. Fixes plugin widgets staying CSP-blocked on cached clients.

## 0.1.5

## 0.1.4

## 0.1.3

### Patch Changes

- Admin/authoring features + fixes: Carousel "posts" items (post query → one slide per post, banner-image backdrop, show-fields author/excerpt/dates/tags with a line-clamped excerpt); post banner-image field; campaign "Show raised amount" toggle + no-goal rendering; plugin widget host mounts once at the app root (loads on admin + survives refresh); block editor no longer deselects on click-outside; shared post-query controls. Types: HeroPostsConfig/HeroPostMeta, campaign showRaisedAmount, nullable post featuredImage.
