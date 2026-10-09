/**
 * Cloudflare Stream — WebRTC (WHIP in, WHEP out; sub-second).
 *
 * One live input per show, created the first time the host asks to publish:
 *   POST  /accounts/{accountId}/stream/live_inputs
 *         { meta: { name, postId }, recording: { mode: 'off' } }
 * The input's `result.webRTC.url` is the WHIP endpoint (the URL itself is the
 * credential — host only) and `result.webRTCPlayback.url` the WHEP endpoint.
 * URLs are read from Cloudflare, never stored; the WHEP URL is memoised per
 * input for a few minutes so a full room does not cost one API call per viewer.
 *
 * Cloudflare does not record WebRTC inputs, hence `recording.mode: 'off'` —
 * the host browser records (services/liveRecordings).
 *
 * Docs: developers.cloudflare.com/stream/webrtc-beta/,
 *       developers.cloudflare.com/api/resources/stream/subresources/live_inputs/
 */
import { AppError, } from '../../core/errors';
import type { LiveAdapterPlayback, LiveAdapterPost, LiveInputResult, LiveProviderAdapter, LiveProviderConfig, } from './types';

export const CF_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15_000;
const PLAYBACK_TTL_MS = 10 * 60_000;
/** Cloudflare's STUN server (their WHIP/WHEP examples use it). */
const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478', },];

interface CfLiveInput {
    uid: string;
    webRTC?: { url?: string; };
    webRTCPlayback?: { url?: string; };
}

interface CfEnvelope<T,> {
    success?: boolean;
    errors?: { code?: number; message?: string; }[];
    result?: T;
}

export class LiveProviderError extends AppError {
    constructor(message: string, public httpStatus?: number,) {
        super(502, 'LIVE_PROVIDER_ERROR', message,);
    }
}

const str = (v: unknown,): string => (typeof v === 'string' ? v.trim() : '');

function creds(cfg: LiveProviderConfig,): { accountId: string; apiToken: string; } {
    const accountId = str(cfg.accountId,);
    const apiToken = str(cfg.apiToken,);
    if (!accountId || !apiToken) throw new LiveProviderError('Cloudflare Stream is missing its Account ID or API token',);
    return { accountId, apiToken, };
}

/** `customer-abc`, `customer-abc.cloudflarestream.com` or a full URL → `https://customer-abc.cloudflarestream.com`. */
export function customerOrigin(raw: unknown,): string | null {
    let v = str(raw,);
    if (!v) return null;
    v = v.replace(/^[a-z]+:\/\//i, '',).split(/[/?#]/,)[0]!.toLowerCase();
    if (!v.includes('.',)) v = `${v}.cloudflarestream.com`;
    return /^[a-z0-9.-]+$/.test(v,) ? `https://${v}` : null;
}

/** Readable message for a failed Cloudflare call. */
export function describeCfError(status: number, body: CfEnvelope<unknown> | null,): string {
    const detail = body?.errors?.map((e,) => e.message).filter(Boolean,).join('; ',);
    if (status === 401 || status === 403) {
        return `Cloudflare rejected the API token — it needs the Stream:Edit permission for this account${detail ? ` (${detail})` : ''}`;
    }
    if (status === 404) return `Cloudflare account not found — check the Account ID${detail ? ` (${detail})` : ''}`;
    if (status === 429) return 'Cloudflare rate limit reached — try again in a minute';
    return `Cloudflare Stream error ${status}${detail ? `: ${detail}` : ''}`;
}

async function cf<T,>(
    cfg: LiveProviderConfig,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<{ status: number; data: CfEnvelope<T> | null; }> {
    const { accountId, apiToken, } = creds(cfg,);
    const url = `${CF_API}/accounts/${encodeURIComponent(accountId,)}/stream/live_inputs${path}`;
    let res: Response;
    try {
        const init: RequestInit = {
            method,
            headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', },
            signal: AbortSignal.timeout(TIMEOUT_MS,),
        };
        if (body !== undefined) init.body = JSON.stringify(body,);
        res = await fetch(url, init,);
    } catch (e) {
        const name = (e as Error)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') throw new LiveProviderError('Cloudflare Stream did not answer within 15 s',);
        throw new LiveProviderError(`Cannot reach Cloudflare Stream: ${(e as Error).message}`,);
    }
    let data: CfEnvelope<T> | null = null;
    try {
        data = await res.json() as CfEnvelope<T>;
    } catch { /* empty / non-JSON body (e.g. DELETE) */ }
    return { status: res.status, data, };
}

function okOrThrow<T,>(r: { status: number; data: CfEnvelope<T> | null; },): T {
    if (r.status >= 200 && r.status < 300 && r.data?.success !== false && r.data?.result) return r.data.result;
    throw new LiveProviderError(describeCfError(r.status, r.data,), r.status,);
}

/** The input, or null when Cloudflare no longer has it (deleted in the dashboard). */
async function getInput(cfg: LiveProviderConfig, uid: string,): Promise<CfLiveInput | null> {
    const r = await cf<CfLiveInput>(cfg, 'GET', `/${encodeURIComponent(uid,)}`,);
    // A 404 for a known account is a missing input; an unknown account
    // surfaces on the create that follows, with the account message.
    if (r.status === 404) return null;
    return okOrThrow(r,);
}

async function createInput(cfg: LiveProviderConfig, post: LiveAdapterPost,): Promise<CfLiveInput> {
    return okOrThrow(await cf<CfLiveInput>(cfg, 'POST', '', {
        meta: { name: post.title.slice(0, 200,) || `Live show ${post.id}`, postId: post.id, },
        recording: { mode: 'off', },
    },),);
}

const playbackCache = new Map<string, { at: number; url: string; }>();

function toResult(input: CfLiveInput,): LiveInputResult {
    const whip = input.webRTC?.url;
    const whep = input.webRTCPlayback?.url;
    if (!input.uid || !whip || !whep) {
        throw new LiveProviderError('Cloudflare returned a live input without WebRTC URLs (webRTC.url / webRTCPlayback.url)',);
    }
    playbackCache.set(input.uid, { at: Date.now(), url: whep, },);
    return {
        inputId: input.uid,
        publish: { provider: 'cloudflare_stream', kind: 'whip', url: whip, token: null, iceServers: ICE_SERVERS, },
        playback: { provider: 'cloudflare_stream', kind: 'whep', url: whep, token: null, iceServers: ICE_SERVERS, },
    };
}

async function ensureInput(post: LiveAdapterPost, cfg: LiveProviderConfig,): Promise<LiveInputResult> {
    const existing = post.providerInputId ? await getInput(cfg, post.providerInputId,) : null;
    return toResult(existing ?? await createInput(cfg, post,),);
}

/** Test-only. */
export function _resetPlaybackCache(): void {
    playbackCache.clear();
}

export const cloudflareStreamAdapter: LiveProviderAdapter = {
    key: 'cloudflare_stream',

    isConfigured(cfg,) {
        return !!cfg && !!str(cfg.accountId,) && !!str(cfg.apiToken,);
    },

    ensureInput,
    publishInfo: ensureInput,

    async playbackInfo(post, cfg,): Promise<LiveAdapterPlayback | null> {
        const uid = post.providerInputId;
        if (!uid) return null;
        const hit = playbackCache.get(uid,);
        let url = hit && Date.now() - hit.at < PLAYBACK_TTL_MS ? hit.url : null;
        if (!url) {
            const input = await getInput(cfg, uid,);
            if (!input?.webRTCPlayback?.url) return null;
            url = input.webRTCPlayback.url;
            playbackCache.set(uid, { at: Date.now(), url, },);
            if (playbackCache.size > 1000) playbackCache.clear();
        }
        return { provider: 'cloudflare_stream', kind: 'whep', url, token: null, iceServers: ICE_SERVERS, };
    },

    async endInput(post, cfg,) {
        const uid = post.providerInputId;
        if (!uid) return;
        playbackCache.delete(uid,);
        const r = await cf(cfg, 'DELETE', `/${encodeURIComponent(uid,)}`,);
        if (r.status === 404 || (r.status >= 200 && r.status < 300)) return;
        throw new LiveProviderError(describeCfError(r.status, r.data,), r.status,);
    },

    async testConnection(cfg,) {
        try {
            const r = await cf<unknown[]>(cfg, 'GET', '',);
            if (r.status >= 200 && r.status < 300 && r.data?.success !== false) {
                const n = Array.isArray(r.data?.result,) ? r.data!.result!.length : 0;
                return { ok: true, message: `Connected to Cloudflare Stream (${n} live input${n === 1 ? '' : 's'} on the account).`, };
            }
            return { ok: false, message: describeCfError(r.status, r.data,), };
        } catch (e) {
            return { ok: false, message: (e as Error).message, };
        }
    },

    cspOrigins(cfg,) {
        const o = customerOrigin(cfg.customerSubdomain,);
        return o ? [o,] : [];
    },
};
