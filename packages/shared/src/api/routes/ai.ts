/**
 * /api/v1/ai — the CMS AI module. Prompts go to a PROVIDER:
 *  - `broker` (default): a Claude Code session attached to a claude-broker
 *    daemon, through the `claude-broker` plugin. Sessions are grouped in
 *    POOLS (a pool = a session label; members `<pool>` or `<pool>-<n>`).
 *  - `anthropic`: the Anthropic Messages API (optional; needs an API key).
 * Every answer comes back in ONE shape, `AiResult`, whatever the provider.
 */

export type AiProviderKey = 'broker' | 'anthropic';

/** pending/in_progress are live; the rest are final. */
export type AiResultStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';

/** The standard answer. */
export interface AiResult {
    /** Broker job id, or `anthropic:<message id>`. */
    id: string;
    provider: AiProviderKey;
    status: AiResultStatus;
    /** The answer as text ('' until completed). */
    text: string;
    /** Parsed JSON when the request asked for `format: 'json'` (or the broker returned an object); else null. */
    data: unknown;
    error: string | null;
    pool: string | null;
    sessionId: string | null;
    /** Model id (anthropic) or the session label (broker). */
    model: string | null;
    /** True when a waiting request gave up before the job settled — poll `GET /ai/jobs/:id`. */
    timedOut: boolean;
    progress: Array<{ note: string; at: string | null; }>;
    meta: Record<string, string>;
    createdAt: string | null;
    completedAt: string | null;
    /** Anthropic token usage, when known. */
    usage?: { inputTokens: number; outputTokens: number; } | null;
}

export interface AiPool {
    name: string;
    /** Sessions expected (configured). */
    expected: number;
    description: string;
    attached: number;
    busy: number;
    idle: number;
    healthy: boolean;
    sessions: Array<{ id: string; label: string; busy: number; }>;
}

export interface AiSession {
    id: string;
    label: string | null;
    status: string;
    pool: string | null;
    busy: number;
    pid: number | null;
    registeredAt: string | null;
    lastHeartbeatAt: string | null;
}

export interface AiProviderStatus {
    key: AiProviderKey;
    label: string;
    /** Usable now. */
    available: boolean;
    /** Why not, when unavailable. */
    reason: string | null;
}

export interface AiStatusResponse {
    defaultProvider: AiProviderKey;
    providers: AiProviderStatus[];
    broker: {
        pluginInstalled: boolean;
        pluginEnabled: boolean;
        reachable: boolean;
        version: string | null;
        sessionCount: number;
        defaultPool: string | null;
        error: string | null;
    };
    pools: AiPool[];
}

export interface AiSettings {
    defaultProvider: AiProviderKey;
    anthropic: {
        /** Masked (`••••••••`) when set; send the mask back to keep it. */
        apiKey: string;
        model: string;
        maxTokens: number;
    };
}

export type AiSettingsResponse = AiSettings;
export interface AiSettingsBody {
    defaultProvider?: AiProviderKey;
    anthropic?: Partial<AiSettings['anthropic']>;
}

export interface AiQueryBody {
    prompt: string;
    /** Instructions put before the prompt (system prompt for anthropic). */
    system?: string;
    provider?: AiProviderKey;
    /** Broker pool (default: the plugin's default pool). */
    pool?: string;
    /** Broker session id or label — overrides `pool`. */
    session?: string;
    /** `json` asks for JSON and fills `data`. */
    format?: 'text' | 'json';
    /** Wait for the answer (default true). false → returns a pending result; poll `GET /ai/jobs/:id`. */
    wait?: boolean;
    timeoutSec?: number;
    /** A short task title shown to the session ("▶ KIND"). */
    kind?: string;
    meta?: Record<string, string>;
    /** Anthropic only. */
    model?: string;
    maxTokens?: number;
}
export type AiQueryResponse = AiResult;

export interface AiSessionsQuery { pool?: string; all?: boolean; }
export type AiSessionsResponse = AiSession[];
export type AiPoolsResponse = AiPool[];

export interface AiJobsQuery { status?: string; pool?: string; limit?: number; all?: boolean; }
export type AiJobsResponse = AiResult[];

export interface AiJobQuery { wait?: number; }
export type AiJobResponse = AiResult;

export interface AiCommentBody { note: string; }
