/**
 * Build the CMS client + tool context from the environment.
 *
 *   CMS_BASE_URL     (required)  e.g. https://cms.example.com or http://localhost:3001
 *   CMS_API_KEY      (required)  a scoped ssk_… key (write/admin scope to author)
 *   CMS_MCP_READONLY (optional)  "true" → only read tools are registered
 *   CMS_MCP_TIMEOUT_MS (optional) request timeout override (ms)
 */
import { createClient, } from '@rw/cms-client';
import type { ToolContext, } from './tool';

export interface McpEnvConfig {
    baseUrl: string;
    apiKey: string;
    readonly: boolean;
    timeoutMs?: number;
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env,): McpEnvConfig {
    const baseUrl = (env.CMS_BASE_URL ?? '').trim();
    const apiKey = (env.CMS_API_KEY ?? '').trim();
    if (!baseUrl) {
        throw new Error('CMS_BASE_URL is required (e.g. https://cms.example.com).',);
    }
    if (!apiKey) {
        throw new Error('CMS_API_KEY is required (a scoped ssk_… API key).',);
    }
    const readonly = (env.CMS_MCP_READONLY ?? '').trim().toLowerCase() === 'true';
    const timeoutRaw = (env.CMS_MCP_TIMEOUT_MS ?? '').trim();
    const timeoutMs = timeoutRaw ? Number(timeoutRaw,) : undefined;
    return { baseUrl, apiKey, readonly, timeoutMs, };
}

/** Short, safe preview of the API key for whoami (never the full secret). */
function keyPreview(apiKey: string,): string {
    if (apiKey.length <= 12) return `${apiKey.slice(0, 4,)}…`;
    return `${apiKey.slice(0, 8,)}…${apiKey.slice(-4,)}`;
}

/** Assemble the client + tool context from a resolved env config. */
export function createContext(config: McpEnvConfig,): ToolContext {
    const cms = createClient({
        baseUrl: config.baseUrl,
        auth: { apiKey: config.apiKey, },
        ...(config.timeoutMs ? { timeoutMs: config.timeoutMs, } : {}),
    },);
    return {
        cms,
        readonly: config.readonly,
        config: {
            baseUrl: config.baseUrl,
            apiKeyPreview: keyPreview(config.apiKey,),
        },
    };
}
