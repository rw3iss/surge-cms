import { defineConfig, } from 'tsup';

export default defineConfig({
    entry: {
        index: '../../packages/cms-mcp/src/index.ts',
    },
    outDir: '../../packages/cms-mcp/dist',
    format: ['esm',],
    target: 'node20',
    platform: 'node',
    // Declarations via `tsc --emitDeclarationOnly` — tsup's bundled dts breaks
    // under the native TS 7 compiler.
    dts: false,
    sourcemap: true,
    clean: true,
    // The MCP entry is a runnable CLI; keep the shebang + mark deps external.
    banner: { js: '#!/usr/bin/env node', },
    external: ['@sitesurge/types', '@sitesurge/client', '@modelcontextprotocol/sdk', 'zod',],
},);
