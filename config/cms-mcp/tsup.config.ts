import { defineConfig, } from 'tsup';

export default defineConfig({
    entry: {
        index: '../../packages/cms-mcp/src/index.ts',
    },
    outDir: '../../packages/cms-mcp/dist',
    format: ['esm',],
    target: 'node20',
    platform: 'node',
    dts: true,
    sourcemap: true,
    clean: true,
    // The MCP entry is a runnable CLI; keep the shebang + mark deps external.
    banner: { js: '#!/usr/bin/env node', },
    external: ['@rw/cms-shared', '@rw/cms-client', '@modelcontextprotocol/sdk', 'zod',],
},);
