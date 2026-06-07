import { defineConfig } from 'vite';
import { resolve } from 'path';
import solidPlugin from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

// This config lives in config/cms/ but the app source is in packages/cms/.
// `root` re-anchors Vite so index.html, public/, and src/ resolve against the
// package; outDir/envDir are pinned explicitly to the package as well.
const CMS_ROOT = resolve(__dirname, '../../packages/cms');

export default defineConfig({
  root: CMS_ROOT,
  envDir: CMS_ROOT,
  publicDir: resolve(CMS_ROOT, 'public'),
  plugins: [
    solidPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'RW',
        short_name: 'RW',
        description: 'Independent journalism for the people',
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
        // The default navigateFallback intercepts every navigation
        // request and serves the SPA's index.html. That breaks
        // backend-served HTML/XML routes (sitemap.xml, feed.xml,
        // robots.txt) and every API call: the SW would hand the SPA
        // shell back instead of the real response. Deny those paths
        // so they pass through to the network and hit the backend.
        navigateFallbackDenylist: [
            /^\/api\//,
            /^\/sitemap\.xml$/,
            /^\/feed\.xml$/,
            /^\/robots\.txt$/,
            /^\/uploads\//,
            /^\/avatars\//,
        ],
        runtimeCaching: [
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
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/avatars': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Public-discoverable backend artifacts. In production the
      // backend serves these from the same origin as the SPA, so
      // relative links like `/sitemap.xml` work either way. In dev
      // the vite server holds the SPA's origin; without these proxy
      // entries, `<a href="/sitemap.xml">` lands on vite's SPA shell
      // (or a 404) instead of the backend route.
      '/sitemap.xml': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/feed.xml': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/robots.txt': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(CMS_ROOT, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['solid-js', '@solidjs/router'],
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        additionalData: `@use 'sass:color';\n@use "${resolve(CMS_ROOT, 'src/styles/variables.scss').replace(/\\/g, '/')}" as *;\n`,
      },
    },
  },
});
