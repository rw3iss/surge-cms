import { resolve, } from 'path';
import { defineConfig, } from 'vitest/config';

export default defineConfig({
    root: resolve(__dirname, '../../packages/cms-mcp',),
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts',],
    },
},);
