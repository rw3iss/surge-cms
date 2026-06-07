import { resolve, } from 'path';
import { defineConfig, } from 'vitest/config';

export default defineConfig({
    // Config lives in config/api/ but the package source is in packages/api/.
    // `root` re-anchors vitest so the include glob resolves against the package.
    root: resolve(__dirname, '../../packages/api',),
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts',],
    },
},);
