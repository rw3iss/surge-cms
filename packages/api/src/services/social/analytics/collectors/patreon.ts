/**
 * Patreon analytics collector (plan §3.7) — API v2, the creator's token.
 *
 * Patreon is revenue + members, not reach: its API has NO post views, likes
 * or comments, and no history (no earnings-over-time, no patron-count series).
 * So we snapshot every day:
 *  - campaign `patron_count` (→ followers)
 *  - from the member list (`campaigns.members` scope): active / paid /
 *    declined / former patrons, monthly income (sum of active members'
 *    `currently_entitled_amount_cents` — an approximation: declines and
 *    refunds only show through `last_charge_status`) and new patrons per day
 *    (members whose `pledge_relationship_start` falls on that day; the last
 *    7 days are rewritten each run).
 * Gained/lost in real time would need the `members:*` webhooks — not wired.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { config, } from '../../../../config';
import { query, } from '../../../../db';
import { registerCollector, } from '../registry';
import type { AccountSnapshot, CollectContext, CollectResult, DailyPoint, } from '../types';

const API = 'https://www.patreon.com/api/oauth2/v2';
const TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const USER_AGENT = 'SiteSurge-CMS (social analytics)';
const CAMPAIGN_FIELDS = 'patron_count,currency,is_monthly,created_at,published_at,vanity,url';
const MEMBER_FIELDS = 'patron_status,currently_entitled_amount_cents,campaign_lifetime_support_cents,pledge_relationship_start,last_charge_status,last_charge_date,is_free_trial,is_gifted';
/** 1000 members per page (Patreon's max) × 50 = 50k members. */
const MAX_PAGES = 50;
const NEW_PATRON_WINDOW = 7;
const SKEW_MS = 5 * 60_000;
/** A hung Patreon socket must not stall the run. */
const TIMEOUT_MS = 30_000;

/** fetch with a timeout; network errors become a plain message (never the URL or headers). */
async function timedFetch(url: string, init: RequestInit,): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS,), },);
    } catch (e) {
        const name = (e as Error)?.name;
        throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `Patreon did not answer within ${TIMEOUT_MS / 1000} s.` : 'Patreon is unreachable (network error).',);
    }
}

export interface PatreonMember {
    patron_status?: 'active_patron' | 'declined_patron' | 'former_patron' | null;
    currently_entitled_amount_cents?: number | null;
    campaign_lifetime_support_cents?: number | null;
    pledge_relationship_start?: string | null;
    last_charge_status?: string | null;
    last_charge_date?: string | null;
    is_free_trial?: boolean | null;
    is_gifted?: boolean | null;
}

export interface PatreonMemberSummary {
    activePatrons: number;
    paidMembers: number;
    freeMembers: number;
    declinedPatrons: number;
    formerPatrons: number;
    monthlyIncomeCents: number;
    lifetimeSupportCents: number;
    /** date (YYYY-MM-DD) → members whose pledge started that day. */
    newByDay: Record<string, number>;
}

const num = (v: unknown,): number => {
    const x = Number(v,);
    return Number.isFinite(x,) ? x : 0;
};

function addDays(day: string, k: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + k,);
    return d.toISOString().slice(0, 10,);
}

// ── Pure mappers (unit-tested) ───────────────────────────────────────────

export function summarizeMembers(members: PatreonMember[],): PatreonMemberSummary {
    const s: PatreonMemberSummary = {
        activePatrons: 0,
        paidMembers: 0,
        freeMembers: 0,
        declinedPatrons: 0,
        formerPatrons: 0,
        monthlyIncomeCents: 0,
        lifetimeSupportCents: 0,
        newByDay: {},
    };
    for (const m of members) {
        const entitled = num(m.currently_entitled_amount_cents,);
        s.lifetimeSupportCents += num(m.campaign_lifetime_support_cents,);
        if (m.patron_status === 'active_patron') {
            s.activePatrons++;
            // A free trial pays nothing yet — its entitled amount is not income.
            if (!m.is_free_trial) s.monthlyIncomeCents += entitled;
            if (entitled > 0 && !m.is_free_trial) s.paidMembers++;
        } else if (m.patron_status === 'declined_patron') s.declinedPatrons++;
        else if (m.patron_status === 'former_patron') s.formerPatrons++;
        else s.freeMembers++; // null status = a free member / follower
        const start = String(m.pledge_relationship_start ?? '',).slice(0, 10,);
        if (/^\d{4}-\d{2}-\d{2}$/.test(start,) && m.patron_status) s.newByDay[start] = (s.newByDay[start] ?? 0) + 1;
    }
    return s;
}

export function patreonAccount(campaign: Record<string, unknown>, summary: PatreonMemberSummary | null, campaignId: string,): AccountSnapshot {
    const patronCount = campaign.patron_count;
    return {
        followers: patronCount === undefined || patronCount === null ? (summary?.activePatrons ?? null) : num(patronCount,),
        raw: {
            campaignId,
            currency: campaign.currency ?? null,
            isMonthly: campaign.is_monthly ?? null,
            url: campaign.url ?? null,
            patronCount: patronCount ?? null,
            ...(summary
                ? {
                    activePatrons: summary.activePatrons,
                    paidMembers: summary.paidMembers,
                    freeMembers: summary.freeMembers,
                    declinedPatrons: summary.declinedPatrons,
                    formerPatrons: summary.formerPatrons,
                    monthlyIncomeCents: summary.monthlyIncomeCents,
                    lifetimeSupportCents: summary.lifetimeSupportCents,
                }
                : {}),
        },
    };
}

/** Today's counts + newPatrons for the last NEW_PATRON_WINDOW days (zeros included, so the series has no gaps). */
export function patreonDaily(today: string, campaign: Record<string, unknown>, summary: PatreonMemberSummary | null,): DailyPoint[] {
    const out: DailyPoint[] = [];
    if (campaign.patron_count !== undefined && campaign.patron_count !== null) {
        out.push({ date: today, metric: 'patrons', value: num(campaign.patron_count,), },);
    }
    if (!summary) return out;
    out.push(
        { date: today, metric: 'activePatrons', value: summary.activePatrons, },
        { date: today, metric: 'paidMembers', value: summary.paidMembers, },
        { date: today, metric: 'declinedPatrons', value: summary.declinedPatrons, },
        { date: today, metric: 'monthlyIncomeCents', value: summary.monthlyIncomeCents, },
    );
    for (let i = NEW_PATRON_WINDOW; i >= 0; i--) {
        const date = addDays(today, -i,);
        out.push({ date, metric: 'newPatrons', value: summary.newByDay[date] ?? 0, },);
    }
    return out;
}

export function grantedScopes(credentials: Record<string, unknown>,): string[] | null {
    const s = String(credentials.scope ?? credentials.grantedScopes ?? '',).trim();
    return s ? s.split(/[\s,]+/,).filter(Boolean,) : null;
}

// ── HTTP + tokens ────────────────────────────────────────────────────────

class PatreonError extends Error {
    constructor(message: string, public status: number,) {
        super(message,);
    }
}

async function getJson(token: string, url: string,): Promise<any> {
    const res = await timedFetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT, }, },);
    const body = await res.json().catch(() => ({})) as { errors?: Array<{ detail?: string; title?: string; }>; };
    if (!res.ok) {
        const e = body.errors?.[0];
        throw new PatreonError(e?.detail || e?.title || `HTTP ${res.status}`, res.status,);
    }
    return body;
}

async function saveCreds(patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider = 'patreon'`,
        [JSON.stringify(patch,),],
    );
}

function appCredentials(creds: Record<string, unknown>,): { id: string; secret: string; } | null {
    const id = String(creds.clientId || creds.appId || config.patreon.clientId || '',);
    const secret = String(creds.clientSecret || creds.appSecret || config.patreon.clientSecret || '',);
    return id && secret ? { id, secret, } : null;
}

/** The connection's credentials as saved right now ({} when unreadable). */
async function savedCreds(): Promise<Record<string, unknown>> {
    try {
        const r = await query<{ credentials: Record<string, unknown> | null; }>(`SELECT credentials FROM social_connections WHERE provider = 'patreon'`,);
        return r.rows?.[0]?.credentials ?? {};
    } catch {
        return {};
    }
}

/**
 * Patreon ROTATES refresh tokens: when another process renewed the token
 * after this run read its credentials, use the saved (newer, still valid)
 * pair instead of refreshing with the stale one. (pure)
 */
export function newerSavedToken(creds: Record<string, unknown>, saved: Record<string, unknown>, now = Date.now(),): string | null {
    const access = saved.accessToken;
    if (typeof access !== 'string' || !access || access === creds.accessToken) return null;
    const at = Date.parse(String(saved.tokenExpiresAt ?? '',),);
    if (Number.isFinite(at,) && at - SKEW_MS <= now) return null;
    for (const k of ['accessToken', 'refreshToken', 'tokenExpiresAt',]) if (saved[k] !== undefined) creds[k] = saved[k];
    return access;
}

export async function refreshPatreonToken(creds: Record<string, unknown>,): Promise<string> {
    const adopted = newerSavedToken(creds, await savedCreds(),);
    if (adopted) return adopted;
    const app = appCredentials(creds,);
    const refresh = String(creds.refreshToken ?? '',);
    if (!app || !refresh) throw new Error('Patreon token expired and no refresh token + client id/secret are saved — reconnect Patreon.',);
    const res = await timedFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: app.id, client_secret: app.secret, },),
    },);
    const data = await res.json().catch(() => ({})) as Record<string, any>;
    if (!res.ok || !data.access_token) {
        const msg = data.error_description || data.error || `HTTP ${res.status}`;
        const late = newerSavedToken(creds, await savedCreds(),);
        if (late) return late;
        await saveCreds({ oauthError: String(msg,), },).catch(() => {});
        throw new Error(`Patreon token refresh failed: ${String(msg,)}`,);
    }
    const patch: Record<string, unknown> = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refresh,
        tokenExpiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in,) * 1000,).toISOString() : null,
        oauthError: null,
    };
    if (data.scope) patch.scope = data.scope;
    await saveCreds(patch,);
    Object.assign(creds, patch,);
    return String(data.access_token,);
}

function tokenOf(creds: Record<string, unknown>,): string {
    return String(creds.accessToken || config.patreon.creatorAccessToken || '',);
}

function tokenExpired(creds: Record<string, unknown>,): boolean {
    const at = Date.parse(String(creds.tokenExpiresAt ?? '',),);
    return Number.isFinite(at,) && at - SKEW_MS <= Date.now();
}

// ── Collector ────────────────────────────────────────────────────────────

const NO_POSTS = 'No post views, likes or comments — Patreon\'s API does not expose post analytics';

function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'patreon' as const, label: 'Patreon', };
    if (!connected || !tokenOf(credentials,)) {
        return { ...base, state: 'off', message: 'Connect Patreon (creator access token) in Social → Configuration.', collects: [], };
    }
    const scopes = grantedScopes(credentials,);
    const campaign = 'Patron count (daily snapshot)';
    const members = 'Active / paid / declined patrons, monthly income, new patrons per day';
    if (scopes && !scopes.includes('campaigns.members',)) {
        return {
            ...base,
            state: 'partial',
            message: 'Reconnect Patreon with the campaigns.members scope to add paid members, monthly income and new patrons.',
            collects: scopes.includes('campaigns',) ? [campaign, NO_POSTS,] : [NO_POSTS,],
        };
    }
    if (tokenExpired(credentials,) && (!credentials.refreshToken || !appCredentials(credentials,))) {
        return { ...base, state: 'partial', message: 'The Patreon token has expired and cannot be renewed — reconnect Patreon.', collects: [campaign, members, NO_POSTS,], };
    }
    if (credentials.oauthError) {
        return { ...base, state: 'partial', message: `Patreon sign-in needs renewing: ${String(credentials.oauthError,)}`, collects: [campaign, members, NO_POSTS,], };
    }
    return { ...base, state: 'ready', message: null, collects: [campaign, members, NO_POSTS,], };
}

async function findCampaign(token: string, creds: Record<string, unknown>,): Promise<{ id: string; attributes: Record<string, unknown>; }> {
    const configured = String(creds.campaignId || config.patreon.campaignId || '',);
    const fields = `fields%5Bcampaign%5D=${CAMPAIGN_FIELDS}`;
    if (configured) {
        const body = await getJson(token, `${API}/campaigns/${encodeURIComponent(configured,)}?${fields}`,);
        return { id: configured, attributes: body.data?.attributes ?? {}, };
    }
    const body = await getJson(token, `${API}/campaigns?${fields}`,);
    const first = (body.data ?? [])[0];
    if (!first) throw new Error('This Patreon account has no campaign.',);
    return { id: String(first.id,), attributes: first.attributes ?? {}, };
}

async function listMembers(token: string, campaignId: string, truncated?: (read: number,) => void,): Promise<PatreonMember[]> {
    const members: PatreonMember[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ 'fields[member]': MEMBER_FIELDS, 'page[count]': '1000', },);
        if (cursor) q.set('page[cursor]', cursor,);
        const body = await getJson(token, `${API}/campaigns/${encodeURIComponent(campaignId,)}/members?${q}`,);
        for (const m of (body.data ?? []) as Array<{ attributes?: PatreonMember; }>) members.push(m.attributes ?? {},);
        const next: string | null = body.meta?.pagination?.cursors?.next ?? null;
        if (!next || next === cursor) {
            cursor = null;
            break;
        }
        cursor = next;
    }
    if (cursor) truncated?.(members.length,);
    return members;
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const creds = { ...ctx.credentials, };
    let token = tokenOf(creds,);
    if (!token) throw new Error('Patreon is not connected (no access token).',);
    if (tokenExpired(creds,)) token = await refreshPatreonToken(creds,);

    let campaign: { id: string; attributes: Record<string, unknown>; };
    try {
        campaign = await findCampaign(token, creds,);
    } catch (e) {
        if (!(e instanceof PatreonError) || e.status !== 401 || !creds.refreshToken) throw e;
        token = await refreshPatreonToken(creds,);
        campaign = await findCampaign(token, creds,);
    }

    let summary: PatreonMemberSummary | null = null;
    try {
        summary = summarizeMembers(await listMembers(token, campaign.id, (read,) =>
            ctx.warn(`Patreon members: stopped after ${read} members (${MAX_PAGES} pages) — counts and income are partial.`,)),);
    } catch (e) {
        const scope = e instanceof PatreonError && (e.status === 401 || e.status === 403) ? ' (needs the campaigns.members scope)' : '';
        ctx.warn(`Patreon members: ${(e as Error).message}${scope}`,);
    }

    return {
        account: patreonAccount(campaign.attributes, summary, campaign.id,),
        daily: patreonDaily(ctx.today, campaign.attributes, summary,),
        posts: [],
    };
}

registerCollector({ platform: 'patreon', label: 'Patreon', connection: 'patreon', status, collect, },);
