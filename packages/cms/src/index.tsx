/* @refresh reload */
import { render, } from 'solid-js/web';
import App from './App';

const root = document.getElementById('root',);

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
    throw new Error(
        'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
    );
}

// Clear any pre-mount content inside #root before the SPA renders: the static
// app-shell loader AND any server-rendered body (the SEO/progressive-enhancement
// markup the backend injects between the SSR_BODY markers). Solid's render()
// APPENDS to #root rather than replacing it, so leftover children would stack
// above the app (visible as unstyled SSR text above the header in production).
root?.replaceChildren();

// Strip the static fallback <title> and <meta name="description"> from index.html
// so that @solidjs/meta's injected equivalents become the only ones in <head>.
//
// The HTML spec says `document.title` reads the FIRST <title> element — so if
// we leave the static one in place, the tab title stays frozen at the fallback
// value even after solid-meta appends its own <title>. Same logic for <meta
// name="description"> and <meta property="og:*"> with duplicates: the static
// ones would shadow the dynamic ones in crawler parsers that only look at the
// first matching element.
//
// We keep the tags in index.html (static file / pre-hydration / SSR fallback)
// but drop them the moment JS takes over, so solid-meta has a clean slate.
function stripStaticMetaFallbacks() {
    const selectors = [
        'title',
        'meta[name="description"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[property="og:type"]',
        'meta[property="og:site_name"]',
        'meta[property="og:locale"]',
        'meta[property="og:image"]',
        'meta[name="twitter:card"]',
        'meta[name="twitter:image"]',
    ];
    for (const selector of selectors) {
        const el = document.head.querySelector(selector,);
        if (el) el.remove();
    }
}
stripStaticMetaFallbacks();

// ── Stale-chunk recovery ─────────────────────────────────────────────────
// After a deploy, a client still running the PREVIOUS bundle (or one served a
// stale index.html) references route chunks by their old content hash. If those
// files are gone from the origin, a lazy `import()` fails with "Failed to fetch
// dynamically imported module" and the route silently doesn't render. Force a
// ONE-TIME reload to pull the fresh index.html + current chunks. A sessionStorage
// guard prevents a reload loop if the fresh load still fails (e.g. a CDN briefly
// serving a stale document); it's cleared once the app has run for a few seconds,
// so recovery re-arms for the next deploy.
const CHUNK_RELOAD_FLAG = 'ss:chunk-reload';
function recoverFromStaleChunk() {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG,)) return; // already tried this session
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1',);
    window.location.reload();
}
function isChunkLoadError(reason: unknown,): boolean {
    const msg = String((reason as { message?: string; } | undefined)?.message ?? reason ?? '',);
    return /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(msg,);
}
// Vite/rolldown dispatches this when a lazily-imported module fails to preload.
window.addEventListener('vite:preloadError', (e,) => { e.preventDefault(); recoverFromStaleChunk(); },);
// Belt-and-braces: the raw dynamic-import rejection (older browsers / direct import()).
window.addEventListener('unhandledrejection', (e,) => {
    if (isChunkLoadError(e.reason,)) recoverFromStaleChunk();
},);
// Re-arm after the app has been running successfully, so a later (post-deploy)
// stale-chunk error can reload again without looping on a still-broken load.
window.addEventListener('load', () => {
    setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_FLAG,), 5000,);
},);

render(() => <App />, root!,);

// Register service worker for PWA (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js',)
            .then((registration,) => {
                console.log('SW registered:', registration,);
            },)
            .catch((error,) => {
                console.log('SW registration failed:', error,);
            },);
    },);
}
