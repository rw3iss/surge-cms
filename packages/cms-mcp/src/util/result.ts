/**
 * Result + error envelopes. Tool handlers return plain JSON-able values; these
 * helpers wrap them in the MCP `content` shape and translate thrown SDK errors
 * (which are typed — ValidationError, NotFoundError, FeatureCascadeError, …)
 * into a structured, actionable error result the agent can reason about.
 */

export interface McpToolResult {
    content: Array<{ type: 'text'; text: string; }>;
    isError?: boolean;
    // The MCP SDK's CallToolResult carries an open index signature; mirror it so
    // our envelope is assignable to the tool-callback return type.
    [key: string]: unknown;
}

/** Wrap a successful handler return as a pretty-printed text result. */
export function okResult(data: unknown,): McpToolResult {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2,);
    return { content: [{ type: 'text', text, },], };
}

/** Translate any thrown value into a structured error result (isError: true). */
export function errorResult(err: unknown,): McpToolResult {
    const e = err as {
        name?: string;
        code?: string;
        message?: string;
        status?: number;
        details?: unknown;
        result?: unknown;
    };
    const payload: Record<string, unknown> = {
        error: e?.name ?? 'Error',
        message: e?.message ?? String(err,),
    };
    if (e?.code !== undefined) payload.code = e.code;
    if (e?.status !== undefined) payload.status = e.status;
    // ValidationError carries details.errors[]; FeatureCascadeError carries the
    // cascade plan on `result`; surface both so the agent can self-correct.
    if (e?.details !== undefined) payload.details = e.details;
    if (e?.result !== undefined) payload.cascade = e.result;
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2,), },],
        isError: true,
    };
}
