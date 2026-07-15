# @sitesurge/admin

## 0.1.6

### Patch Changes

- PWA: serve the SPA shell NetworkFirst instead of from the precache navigation fallback, so server response headers (notably a plugin-extended CSP) always reach the browser. Fixes plugin widgets staying CSP-blocked on cached clients.

## 0.1.5

## 0.1.4

## 0.1.3

### Patch Changes

- Admin/authoring features + fixes: Carousel "posts" items (post query → one slide per post, banner-image backdrop, show-fields author/excerpt/dates/tags with a line-clamped excerpt); post banner-image field; campaign "Show raised amount" toggle + no-goal rendering; plugin widget host mounts once at the app root (loads on admin + survives refresh); block editor no longer deselects on click-outside; shared post-query controls. Types: HeroPostsConfig/HeroPostMeta, campaign showRaisedAmount, nullable post featuredImage.
