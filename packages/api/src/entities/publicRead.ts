/**
 * Public-read rules for the generic entity service.
 *
 * The bespoke modules (posts, pages, …) each enforce their own visibility on a
 * public read. The generic `/entities/:type` surface reads the SAME tables, so
 * it has to enforce the same rules, or it becomes a side door:
 *
 *  - **Status.** A non-staff caller never sees a `draft` or `archived` record —
 *    not on a list (an extra SQL condition, so totals stay right), not on a
 *    single read (404), not by asking for `status=draft` explicitly.
 *  - **Page access.** A `page` read follows `GET /pages/slug/:slug`: a private
 *    page needs a signed-in viewer, and a page whose `access_level` is
 *    member/patron needs a viewer who passes `checkContentAccess`. A page the
 *    viewer may not open is left out of a list and 404s on a single read (a
 *    page's body lives in its blocks, so only metadata was ever exposed here,
 *    but the rule should not differ from the bespoke route).
 *  - **Post subscription gate.** A `post` read is run through `services/postGate`
 *    exactly like `GET /posts`: hidden posts are left out in SQL, a locked post's
 *    `content` is replaced by its sample (or nothing), and `gate` is stamped.
 *
 * Callers that pass no viewer (SSR, mail, the backend template runtime) are
 * treated as ANONYMOUS, which is what those surfaces are.
 */
import type { EntityRecord, EntityTypeDef, Post, User, } from '@sitesurge/types';
import { query, } from '../db';
import { gateFor, hiddenClause, isHiddenFor, tiersById, type ViewerRank, viewerRank, } from '../services/postGate';
import { samplePostContent, } from '../services/postGate/samples';
import type { SqlCondition, } from './virtualFilters';
import { checkContentAccess, type ContentAccessLevel, } from '../middleware/content-access';
import { isStaffRole, } from '@sitesurge/types';

export type EntityViewer = Pick<User, 'id' | 'role'> | null | undefined;

/** Statuses a non-staff caller may never read, for any type that has a status. */
export const HIDDEN_STATUSES: readonly string[] = ['draft', 'archived',];

export function isHiddenStatus(status: unknown,): boolean {
    return typeof status === 'string' && HIDDEN_STATUSES.includes(status,);
}

/** SQL condition excluding hidden statuses (for the generic repo's `extraWhere`). */
export const visibleStatusCondition: SqlCondition = (params,) => {
    params.push([...HIDDEN_STATUSES,],);
    return `"status"::text <> ALL($${params.length}::text[])`;
};

/** Types whose public read goes through the post subscription gate. */
export function isGatedType(typeKey: string,): boolean {
    return typeKey === 'post';
}

/** Rank of the viewer (null = anonymous / no tier). Only meaningful for gated types. */
export async function rankFor(viewer: EntityViewer,): Promise<ViewerRank> {
    return viewerRank(viewer ?? null,);
}

/** SQL condition dropping posts hidden from a viewer of `rank`. */
export function hiddenPostCondition(rank: ViewerRank,): SqlCondition | null {
    if (rank === Infinity) return null;
    return (params,) => {
        // hiddenClause returns " AND (…)" against an alias; the generic repo
        // queries the table unaliased, so the table name is the alias.
        const clause = hiddenClause('"posts"', rank, params,);
        return clause.replace(/^\s*AND\s*/, '',) || 'TRUE';
    };
}

interface GateRow {
    id: string;
    required_tier_id: string | null;
    gate_hidden: boolean | null;
    gate_show_sample: boolean | null;
    gate_sample_percent: number | null;
    content: string | null;
    post_type: string | null;
}

/**
 * Apply the post gate to records read through the generic repo. Mutates and
 * returns the records that remain (hidden ones are dropped). Never throws on a
 * missing gate column — a record whose row is gone is dropped.
 */
export async function gatePostRecords(records: EntityRecord[], rank: ViewerRank,): Promise<EntityRecord[]> {
    if (records.length === 0 || rank === Infinity) return records;
    const ids = records.map((r,) => String(r.id,),);
    const [rows, tiers,] = await Promise.all([
        query<GateRow>(
            `SELECT id, required_tier_id, gate_hidden, gate_show_sample, gate_sample_percent, content, post_type
               FROM posts WHERE id = ANY($1::uuid[])`,
            [ids,],
        ),
        tiersById(),
    ],);
    const byId = new Map(rows.rows.map((r,) => [String(r.id,), r,],),);
    const out: EntityRecord[] = [];
    for (const rec of records) {
        const row = byId.get(String(rec.id,),);
        if (!row) continue;
        const fields = {
            requiredTierId: row.required_tier_id,
            gateHidden: !!row.gate_hidden,
            gateShowSample: !!row.gate_show_sample,
            gateSamplePercent: row.gate_sample_percent ?? 25,
        } as Pick<Post, 'requiredTierId' | 'gateHidden' | 'gateShowSample' | 'gateSamplePercent'>;
        const gate = gateFor(fields, rank, tiers,);
        if (isHiddenFor(fields, gate,)) continue;
        (rec as Record<string, unknown>).gate = gate;
        if (gate.state === 'locked') {
            const sample = gate.sample
                ? samplePostContent({ content: row.content ?? '', postType: row.post_type ?? 'article', } as unknown as Post, fields.gateSamplePercent ?? 25,).content
                : '';
            // Replace every copy of the body the record carries.
            for (const key of ['content', 'body',]) if (key in rec) (rec as Record<string, unknown>)[key] = sample;
        }
        out.push(rec,);
    }
    return out;
}

/** Types whose public read applies the page access rule. */
export function isAccessControlledType(typeKey: string,): boolean {
    return typeKey === 'page';
}

function pick(rec: EntityRecord, camel: string, snake: string,): unknown {
    const r = rec as Record<string, unknown>;
    return r[camel] !== undefined ? r[camel] : r[snake];
}

/** May `viewer` open this page record (private + access_level, as GET /pages/slug/:slug)? */
export async function pageAllows(rec: EntityRecord, viewer: EntityViewer,): Promise<boolean> {
    if (viewer && isStaffRole(viewer.role,)) return true;
    if (pick(rec, 'isPrivate', 'is_private',) === true && !viewer) return false;
    const level = (pick(rec, 'accessLevel', 'access_level',) || 'public') as ContentAccessLevel;
    if (level === 'public') return true;
    const res = await checkContentAccess(level, (viewer ?? null) as User | null,).catch(() => ({ allowed: false, }));
    return res.allowed;
}

/** The page records `viewer` may open, in order. */
export async function filterPageRecords(records: EntityRecord[], viewer: EntityViewer,): Promise<EntityRecord[]> {
    if (records.length === 0) return records;
    const allowed = await Promise.all(records.map((r,) => pageAllows(r, viewer,)),);
    return records.filter((_, i,) => allowed[i],);
}

/** True when a non-staff caller may read this record at all (status rule). */
export function statusAllows(t: Pick<EntityTypeDef, 'hasStatus'>, rec: EntityRecord,): boolean {
    return !t.hasStatus || !isHiddenStatus(rec.status,);
}
