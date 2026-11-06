/**
 * Facebook Page picker for the Facebook connection.
 *
 * The connection holds a USER token (Facebook Login). Analytics needs a Page:
 * `pages()` lists the Pages that token manages (with the user's tasks on each —
 * ANALYZE is what unlocks Page insights), and `selectPage()` saves the chosen
 * Page's id + Page token + the scopes the user granted (from /me/permissions),
 * which the analytics collector reads to say what it can and cannot collect.
 */
import { query, } from '../../db';
import { NotFoundError, ValidationError, } from '../../core/errors';
import type { FacebookPageOption, } from '@sitesurge/types';
import { FACEBOOK_GRAPH, graphGet, isTokenError, tokenErrorHint, } from './analytics/collectors/metaGraph';

interface AccountRow {
    id: string;
    name?: string;
    category?: string;
    tasks?: string[];
    access_token?: string;
}

async function connection(): Promise<{ creds: Record<string, unknown>; userToken: string; }> {
    const r = await query<{ credentials: Record<string, unknown> | null; }>(
        `SELECT credentials FROM social_connections WHERE provider = 'facebook'`,
    );
    const creds = r.rows[0]?.credentials ?? null;
    if (!creds) throw new NotFoundError('Facebook connection',);
    const userToken = String(creds.accessToken ?? '',).trim();
    if (!userToken) throw new ValidationError('Add a Facebook access token first.',);
    return { creds, userToken, };
}

async function accounts(userToken: string,): Promise<AccountRow[]> {
    try {
        const r = await graphGet<{ data?: AccountRow[]; }>(
            FACEBOOK_GRAPH, 'me/accounts', { fields: 'id,name,category,tasks,access_token', limit: '100', }, userToken,
        );
        return r.data ?? [];
    } catch (e) {
        // A Graph failure is the operator's to fix, not a server error (graphGet never echoes the token).
        if (isTokenError(e,)) throw new ValidationError(`Facebook rejected the access token — ${tokenErrorHint(e,)}. Reconnect Facebook, then pick the Page.`,);
        throw new ValidationError(`Facebook did not list the Pages: ${(e as Error).message}`,);
    }
}

/** Pages the connected user manages. Empty when the token is a Page token (it has no /me/accounts). */
export async function pages(): Promise<FacebookPageOption[]> {
    const { creds, userToken, } = await connection();
    // A Page token has no /me/accounts (empty list); a rejected token is reported.
    const list = await accounts(userToken,).catch((e,) => {
        if (e instanceof ValidationError && /rejected the access token/.test(e.message,)) throw e;
        return [] as AccountRow[];
    },);
    return list.map((p,) => ({
        id: p.id,
        name: p.name ?? p.id,
        category: p.category ?? null,
        tasks: p.tasks ?? [],
        canAnalyze: (p.tasks ?? []).includes('ANALYZE',),
        selected: String(creds.pageId ?? '',) === p.id,
    }));
}

/** Granted scopes of the user token (empty when /me/permissions is not readable). */
async function grantedScopes(userToken: string,): Promise<string[]> {
    try {
        const r = await graphGet<{ data?: Array<{ permission: string; status: string; }>; }>(FACEBOOK_GRAPH, 'me/permissions', {}, userToken,);
        return (r.data ?? []).filter((p,) => p.status === 'granted').map((p,) => p.permission);
    } catch {
        return [];
    }
}

/** Save the chosen Page: id, Page token, display name, granted scopes; clears stale capabilities. */
export async function selectPage(pageId: string,): Promise<FacebookPageOption> {
    const { creds, userToken, } = await connection();
    const page = (await accounts(userToken,)).find((p,) => p.id === pageId);
    if (!page) throw new ValidationError('That Page is not managed by the connected Facebook account.',);
    const scopes = await grantedScopes(userToken,);
    const next: Record<string, unknown> = {
        ...creds,
        pageId: page.id,
        ...(scopes.length ? { grantedScopes: scopes, } : {}),
    };
    // The previous Page's token and capability record belong to that Page —
    // keeping its token would make the collector read the OLD Page.
    if (page.access_token) next.pageAccessToken = page.access_token;
    else delete next.pageAccessToken;
    delete next.analyticsCapabilities;
    await query(
        `UPDATE social_connections SET credentials = $1::jsonb, display_name = $2, account_id = $3, updated_at = NOW()
         WHERE provider = 'facebook'`,
        [JSON.stringify(next,), page.name ?? null, page.id,],
    );
    return {
        id: page.id,
        name: page.name ?? page.id,
        category: page.category ?? null,
        tasks: page.tasks ?? [],
        canAnalyze: (page.tasks ?? []).includes('ANALYZE',),
        selected: true,
    };
}
