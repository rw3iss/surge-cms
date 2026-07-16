import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import solidPlugin from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

// This config lives in config/cms/ but the app source is in packages/cms/.
// `root` re-anchors Vite so index.html, public/, and src/ resolve against the
// package; outDir/envDir are pinned explicitly to the package as well.
const CMS_ROOT = resolve(__dirname, '../../packages/cms');

export default defineConfig(({ mode }) => {
  // Dev server + API proxy are env-driven so multiple sites built from this
  // same codebase can run side by side without colliding. Defaults preserve the
  // original single-site setup (frontend :3000 → backend :3001). Override per
  // site in packages/cms/.env: CMS_PORT (frontend port) and CMS_API_TARGET
  // (backend origin to proxy /api, /uploads, etc. to).
  const env = loadEnv(mode, CMS_ROOT, '');
  const apiTarget = env.CMS_API_TARGET ?? 'http://localhost:3001';
  const proxyEntry = { target: apiTarget, changeOrigin: true };

  return {
  root: CMS_ROOT,
  envDir: CMS_ROOT,
  publicDir: resolve(CMS_ROOT, 'public'),
  resolve: {
    alias: {
      // `@/` → packages/cms/src. Replaces fragile deep `../../../../` chains
      // (the ui barrel already documents this import style). Mirror any change
      // in config/cms/tsconfig.json `paths` so tsc/IDE resolve it too.
      '@': resolve(CMS_ROOT, 'src'),
      // Resolve @sitesurge/types to its TS SOURCE (ESM) rather than the built
      // CJS dist. The dist emits CommonJS (for Node-resolvable `node dist`),
      // whose `__exportStar` re-exports Vite's dev-server ESM analysis can't
      // see through (e.g. `import { isAdminRole }`). Source resolution gives
      // real named exports + HMR on shared changes.
      '@sitesurge/types': resolve(CMS_ROOT, '../shared/src/index.ts'),
    },
  },
  plugins: [
    solidPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'SiteSurge',
        short_name: 'SiteSurge',
        description: 'A SiteSurge CMS site',
        theme_color: '#3498cf',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Disable the precache navigation fallback. It served the SPA shell
        // (index.html) from the precache for every navigation, which FROZE
        // the document's response headers — most importantly the CSP. A
        // plugin-extended connect-src (set server-side per enabled plugin)
        // therefore never reached the browser and the widget was blocked.
        // Navigations are handled NetworkFirst below instead (fresh headers
        // online, cached shell offline). `undefined` overrides the
        // vite-plugin-pwa default of 'index.html'.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            // The SPA shell (the HTML document) must be fetched fresh so
            // server-set response headers — chiefly a plugin-extended CSP —
            // always propagate. Precaching index.html and serving it via the
            // navigation fallback froze the CSP header, so an enabled plugin's
            // connect-src (e.g. PageLoop → its endpoint) never reached the
            // browser. NetworkFirst serves the live document online and falls
            // back to the last cached copy offline. Registered first so it wins
            // navigation requests over the precache navigation fallback.
            urlPattern: ({ request, url }: { request: Request; url: URL; }) =>
              request.mode === 'navigate'
              && !/^\/(api|uploads|avatars)\/|^\/(sitemap\.xml|feed\.xml|robots\.txt)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-shell',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: Number(env.CMS_PORT ?? 3000),
    // Fail loudly if the port is taken instead of silently bumping to the next
    // free port — a silent bump is what makes a second site look like it works
    // while actually proxying to the first site's backend.
    strictPort: true,
    proxy: {
      '/api': proxyEntry,
      '/uploads': proxyEntry,
      '/avatars': proxyEntry,
      // Public-discoverable backend artifacts. In production the
      // backend serves these from the same origin as the SPA, so
      // relative links like `/sitemap.xml` work either way. In dev
      // the vite server holds the SPA's origin; without these proxy
      // entries, `<a href="/sitemap.xml">` lands on vite's SPA shell
      // (or a 404) instead of the backend route.
      '/sitemap.xml': proxyEntry,
      '/feed.xml': proxyEntry,
      '/robots.txt': proxyEntry,
    },
  },
  build: {
    outDir: resolve(CMS_ROOT, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
    // vite 8 bundles with rolldown, which rejects the object form of
    // `manualChunks`. Rolldown's automatic chunking already splits vendor
    // code sensibly, so we let it handle chunking rather than porting to the
    // `advancedChunks` API.
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        additionalData: `@use 'sass:color';\n@use "${resolve(CMS_ROOT, 'src/styles/variables.scss').replace(/\\/g, '/')}" as *;\n`,
      },
    },
  },
  };
});
