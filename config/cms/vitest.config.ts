import { defineConfig, } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { fileURLToPath, } from 'node:url';

/**
 * Vitest config for @sitesurge/admin.
 *
 * WHY THIS EXISTS: without it vitest resolves `solid-js` through the `node`
 * export condition, which is Solid's SSR build. Signals happen to work there,
 * so the store tests passed and nobody noticed — but anything reactive beyond
 * them does not: `createResource` under the server build wants a hydration
 * context and throws "getNextContextId cannot be used under non-hydrating
 * context". The admin is a pure client-rendered SPA with no SSR entry, so the
 * browser build is the only one its tests should ever see.
 *
 * `solidPlugin` is included so a test may import a component (JSX needs Solid's
 * transform, not the default esbuild/oxc one). `test.environment` stays 'node':
 * the reactive primitives do not need a DOM, and jsdom is not a dependency.
 */
export default defineConfig({
    plugins: [solidPlugin(),],
    resolve: {
        conditions: ['browser', 'development',],
    },
    test: {
        root: fileURLToPath(new URL('../../packages/cms', import.meta.url,),),
        environment: 'node',
        include: ['src/**/*.test.{ts,tsx}',],
    },
},);
