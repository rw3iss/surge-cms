import { defineConfig, } from 'tsup';

export default defineConfig({
    entry: {
        index: '../../packages/cms-client/src/index.ts',
        solid: '../../packages/cms-client/src/adapters/solid.ts',
    },
    outDir: '../../packages/cms-client/dist',
    format: ['esm', 'cjs',],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['@rw/cms-shared', 'solid-js',],
},);
