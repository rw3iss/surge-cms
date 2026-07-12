/**
 * @sitesurge/mcp — MCP server exposing the SiteSurge CMS authoring surface.
 *
 * Run (stdio): CMS_BASE_URL=… CMS_API_KEY=ssk_… cms-mcp
 * See docs/MCP.md for the full tool reference.
 */
import { StdioServerTransport, } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext, readEnvConfig, } from './client';
import { buildServer, } from './server';

async function main(): Promise<void> {
    const config = readEnvConfig();
    const ctx = createContext(config,);
    const server = buildServer(ctx,);
    const transport = new StdioServerTransport();
    await server.connect(transport,);
    // stderr is safe for logs (stdout is the JSON-RPC channel).
    process.stderr.write(
        `[cms-mcp] connected to ${config.baseUrl}${config.readonly ? ' (read-only)' : ''}\n`,
    );
}

main().catch((err,) => {
    process.stderr.write(`[cms-mcp] fatal: ${(err as Error).message}\n`,);
    process.exit(1,);
},);
