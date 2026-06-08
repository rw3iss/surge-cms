import { resolve, } from 'path';
import { defineConfig, } from 'vitest/config';

/**
 * Integration smoke config — RUN MANUALLY against a live API (see
 * packages/cms-client/test-integration/smoke.test.ts). Kept separate from the
 * unit config so `npm test` never boots a server. Picks up only the
 * test-integration/ tree, which sits outside `src/` and is therefore invisible
 * to the unit run.
 */
export default defineConfig({
    root: resolve(__dirname, '../../packages/cms-client',),
    test: {
        environment: 'node',
        include: ['test-integration/**/*.test.ts',],
        testTimeout: 30_000,
    },
},);
