/**
 * Live shows ↔ the streaming provider: host ingest (WHIP), viewer playback
 * (WHEP), provider test, the CSP origins the browser needs, and the
 * end-of-show cleanup. The room itself (chat, status) is services/liveRooms.
 *
 * The provider resource (e.g. a Cloudflare live input) is created the first
 * time the host asks to publish and its id kept in
 * `posts.type_settings.providerInputId`. Playback never creates one.
 */
import type { LivePlaybackInfo, LivePublishInfo, User, } from '@sitesurge/types';
import { ConflictError, NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { cache, } from './cache';
import { getAdapter, getLiveProvider, type LiveAdapterPost, type LiveProviderAdapter, type LiveProviderConfig, } from './liveProviders';
import { viewAccess, } from './liveRooms/access';
import { effectiveStatus, isLivePost, loadLivePost, type LivePostRow, } from './liveRooms/state';
import { getPostsSettings, } from './postSettings';
import { logger, } from '../utils/logger';

export interface ActiveProvider {
    key: string;
    cfg: LiveProviderConfig;
    adapter: LiveProviderAdapter;
}

type ProviderLookup = ActiveProvider | { reason: 'no_provider' | 'not_configured'; key?: string; };

/** The selected provider with its config + adapter, or why there is none. */
export async function activeProvider(): Promise<ProviderLookup> {
    const s = await getPostsSettings();
    const key = s.live.provider;
    if (!key) return { reason: 'no_provider', };
    const adapter = getAdapter(key,);
    const cfg = s.live.providers[key] ?? {};
    if (!adapter || !adapter.isConfigured(cfg,)) return { reason: 'not_configured', key, };
    return { key, cfg, adapter, };
}

const isActive = (p: ProviderLookup,): p is ActiveProvider => 'adapter' in p;

function adapterPost(row: LivePostRow,): LiveAdapterPost {
    const id = row.typeSettings.providerInputId;
    return { id: row.id, title: row.title ?? '', providerInputId: typeof id === 'string' && id ? id : null, };
}

async function setProviderInputId(postId: string, inputId: string | null,): Promise<void> {
    await query(
        `UPDATE posts SET type_settings = COALESCE(type_settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [postId, JSON.stringify({ providerInputId: inputId, },),],
    );
    await cache.invalidatePostCache(postId,);
}

// ─── CSP ──────────────────────────────────────────────────────────

/** Origins seen in real WHIP/WHEP URLs (covers a mistyped customer subdomain). */
const observedOrigins = new Set<string>();

function noteOrigin(url: string | undefined,): void {
    try {
        if (url) observedOrigins.add(new URL(url,).origin,);
    } catch { /* not a URL */ }
}

/**
 * Push the active provider's browser-facing origins into the CSP. Called at
 * boot, after a settings save, and on publish/playback (so every cluster
 * worker converges without a restart). No-op when unchanged.
 */
export async function syncLiveCsp(): Promise<void> {
    try {
        const s = await getPostsSettings();
        const key = s.live.provider;
        const adapter = getAdapter(key,);
        const origins = adapter?.cspOrigins && key ? adapter.cspOrigins(s.live.providers[key] ?? {},) : [];
        const { setLiveProviderCspOrigins, } = await import('../middleware/csp.js');
        setLiveProviderCspOrigins([...origins, ...(adapter ? observedOrigins : []),],);
    } catch (e) {
        logger.warn('Live provider CSP sync failed', { error: (e as Error).message, },);
    }
}

// ─── Host ingest ──────────────────────────────────────────────────

/** POST /posts/:id/live/publish — the caller already holds `posts.live:host`. */
export async function publish(postId: string,): Promise<LivePublishInfo> {
    const row = await loadLivePost(postId,);
    if (!row || !isLivePost(row,)) throw new NotFoundError('Live show',);
    if (effectiveStatus(row,) === 'ended') throw new ConflictError('This show has ended', { code: 'ended', },);
    const p = await activeProvider();
    if (!isActive(p,)) {
        throw new ValidationError(p.reason === 'no_provider'
            ? 'No live provider is selected (Settings → Posts → Live Show)'
            : `The live provider "${getLiveProvider(p.key,)?.label ?? p.key}" is not configured or not available yet`,);
    }
    const post = adapterPost(row,);
    const res = await p.adapter.publishInfo(post, p.cfg,);
    if (res.inputId !== post.providerInputId) await setProviderInputId(row.id, res.inputId,);
    noteOrigin(res.publish.url,);
    noteOrigin(res.playback.url,);
    await syncLiveCsp();
    return res.publish;
}

// ─── Viewer playback ──────────────────────────────────────────────

/** GET /posts/:id/live/playback — per viewer; never cached. */
export async function playback(postId: string, user: Pick<User, 'id' | 'role'> | undefined | null,): Promise<LivePlaybackInfo> {
    const row = await loadLivePost(postId,);
    const access = await viewAccess(row, user ?? null,);
    if (access === 'not_found' || !row) throw new NotFoundError('Live show',);
    if (access !== 'ok') return { available: false, reason: 'forbidden', };
    const status = effectiveStatus(row,);
    if (status === 'ended') return { available: false, reason: 'ended', };
    if (status !== 'live' && status !== 'paused') return { available: false, reason: 'not_live', };
    const p = await activeProvider();
    if (!isActive(p,)) return { available: false, reason: p.reason, };
    const info = await p.adapter.playbackInfo(adapterPost(row,), p.cfg,);
    // Live, but the host has not connected to the provider yet.
    if (!info) return { available: false, reason: 'not_live', };
    noteOrigin(info.url,);
    await syncLiveCsp();
    return { available: true, ...info, };
}

// ─── Settings test ────────────────────────────────────────────────

/** POST /posts/settings/live/test — with the SAVED config. */
export async function testProvider(key: string,): Promise<{ ok: boolean; message: string; }> {
    const descriptor = getLiveProvider(key,);
    if (!descriptor) throw new ValidationError(`Unknown live provider "${key}"`,);
    const adapter = getAdapter(key,);
    if (!adapter) return { ok: false, message: `${descriptor.label} is not available yet — settings only.`, };
    const s = await getPostsSettings();
    const cfg = s.live.providers[key] ?? {};
    if (!adapter.isConfigured(cfg,)) return { ok: false, message: 'Fill in and save the required fields first.', };
    return adapter.testConnection(cfg,);
}

// ─── End of show ──────────────────────────────────────────────────

/**
 * The host ended the show: release the provider input (best-effort) and arm
 * the recording safety net. Never throws.
 */
export async function onShowEnded(postId: string,): Promise<void> {
    try {
        const row = await loadLivePost(postId,);
        const post = row ? adapterPost(row,) : null;
        if (post?.providerInputId) {
            const p = await activeProvider();
            if (isActive(p,)) await p.adapter.endInput(post, p.cfg,);
        }
    } catch (e) {
        logger.warn('Live provider input cleanup failed', { postId, error: (e as Error).message, },);
    }
    try {
        const { scheduleAutoFinalize, } = await import('./liveRecordings.js');
        scheduleAutoFinalize(postId,);
    } catch (e) {
        logger.warn('Live recording safety net not armed', { postId, error: (e as Error).message, },);
    }
}
