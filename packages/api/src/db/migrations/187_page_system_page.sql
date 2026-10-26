-- "Use as page": a CMS page may stand in for a built-in screen (homepage, /shop,
-- /subscribe, …). Keys come from SYSTEM_PAGES in @sitesurge/types
-- (utils/systemPages.ts). One page per key. `is_homepage` stays as a mirror of
-- system_page = 'home' for older readers (SDK/MCP `isHomepage`, sitemap, SSR).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS system_page TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_system_page ON pages(system_page) WHERE system_page IS NOT NULL;

UPDATE pages SET system_page = 'home'
 WHERE is_homepage = true AND system_page IS NULL
   AND NOT EXISTS (SELECT 1 FROM pages WHERE system_page = 'home');

-- Shop Settings "What /shop shows: My own 'shop' page" becomes the shop page's
-- "Use as page: Shop"; the setting is retired.
UPDATE pages SET system_page = 'shop'
 WHERE slug = 'shop' AND status <> 'deleted' AND system_page IS NULL
   AND EXISTS (SELECT 1 FROM site_settings WHERE key = 'shop_settings' AND value->>'storefrontMode' = 'page')
   AND NOT EXISTS (SELECT 1 FROM pages WHERE system_page = 'shop');
UPDATE site_settings SET value = value - 'storefrontMode' WHERE key = 'shop_settings' AND value ? 'storefrontMode';
