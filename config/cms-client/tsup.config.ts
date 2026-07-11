import { defineConfig, } from 'tsup';

export default defineConfig({
    entry: {
        index: '../../packages/cms-client/src/index.ts',
        solid: '../../packages/cms-client/src/adapters/solid.ts',
    },
    outDir: '../../packages/cms-client/dist',
    format: ['esm', 'cjs',],
    // Declarations are emitted by `tsc --emitDeclarationOnly` in the build
    // script — tsup's bundled dts uses the legacy TypeScript JS API that the
    // native TS 7 compiler doesn't provide (crashes on useCaseSensitiveFileNames).
    dts: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['@rw/cms-shared', 'solid-js',],
},);
