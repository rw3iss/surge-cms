/**
 * Comment targets for the Comments feature: posts and events.
 *
 * Reading follows the item: a post's comments are visible only to a viewer
 * who can read the FULL post (published, not private, passes its subscription
 * gate); an event's only while it is published. Staff always read.
 */
import { query, } from '../../db';
import { registerCommentTarget, type TargetAccess, } from '../discussions/targets';
import { isStaffViewer, type Viewer, } from '../discussions/viewer';
import { gateFor, isHiddenFor, tiersById, viewerRank, } from '../postGate';
import { getSettings as getEventsSettings, } from '../events/settings';
import { getSettings as getCommentsSettings, } from './settings';
import * as threads from './threads';

async function needsApproval(_viewer: Viewer, isGuest: boolean,): Promise<boolean> {
    const s = await getCommentsSettings();
    return s.approveAll || (isGuest && s.approveAnonymous);
}

function openFor(thread: Awaited<ReturnType<typeof threads.get>>,): Pick<TargetAccess, 'canComment' | 'allowAnonymous' | 'reason'> {
    if (!thread.enabled) return { canComment: false, allowAnonymous: false, reason: 'Comments are off for this item.', };
    if (thread.locked) return { canComment: false, allowAnonymous: false, reason: 'Comments are closed.', };
    return { canComment: true, allowAnonymous: thread.allowAnonymous, };
}

// ─── post ───────────────────────────────────────────────────────────

interface PostRow {
    id: string; title: string; slug: string; status: string; is_private: boolean;
    required_tier_id: string | null; gate_hidden: boolean; gate_show_sample: boolean; gate_sample_percent: number;
}

registerCommentTarget({
    type: 'post',
    feature: 'comments',
    writePermission: 'comments:write',
    async access(id, viewer,) {
        const p = (await query<PostRow>(
            `SELECT id, title, slug, status, is_private, required_tier_id, gate_hidden, gate_show_sample, gate_sample_percent
               FROM posts WHERE id = $1`, [id,],
        )).rows[0];
        if (!p) return null;
        const staff = isStaffViewer(viewer,);
        if (!staff && (p.status !== 'published' || p.is_private)) return null;
        const thread = await threads.get('post', id,);
        const base = { title: p.title, url: `/posts/${p.slug}`, ...openFor(thread,), };
        if (staff) return { ...base, canRead: true, };
        const gateFields = {
            requiredTierId: p.required_tier_id, gateHidden: p.gate_hidden,
            gateShowSample: p.gate_show_sample, gateSamplePercent: p.gate_sample_percent,
        };
        const gate = gateFor(gateFields, await viewerRank(viewer as never,), await tiersById(),);
        if (isHiddenFor(gateFields, gate,)) return null;
        if (gate.state === 'locked') {
            return { ...base, canRead: false, canComment: false, reason: 'Comments are for subscribers.', };
        }
        return { ...base, canRead: true, };
    },
    async summaries(ids,) {
        const r = await query<{ id: string; title: string; slug: string; }>(`SELECT id, title, slug FROM posts WHERE id = ANY($1::uuid[])`, [ids,],);
        return new Map(r.rows.map((p,) => [p.id, { title: p.title, url: `/posts/${p.slug}`, },],),);
    },
    activityKind: () => 'comments',
    needsApproval,
    onCountChange: (client, id, delta,) => threads.bump(client, 'post', id, delta,),
    reconcile: () => threads.reconcile('post',),
},);

// ─── event ──────────────────────────────────────────────────────────

async function eventsBase(): Promise<string> {
    const s = await getEventsSettings().catch(() => null);
    return (s?.eventsUrl || '/events').replace(/\/+$/, '',);
}

registerCommentTarget({
    type: 'event',
    feature: 'comments',
    writePermission: 'comments:write',
    async access(id, viewer,) {
        const e = (await query<{ id: string; title: string; slug: string; status: string; }>(
            `SELECT id, title, slug, status FROM events WHERE id = $1`, [id,],
        ).catch(() => ({ rows: [], }))).rows[0];
        if (!e) return null;
        const staff = isStaffViewer(viewer,);
        if (!staff && e.status !== 'published') return null;
        const thread = await threads.get('event', id,);
        return { title: e.title, url: `${await eventsBase()}/${e.slug}`, canRead: true, ...openFor(thread,), };
    },
    async summaries(ids,) {
        const base = await eventsBase();
        const r = await query<{ id: string; title: string; slug: string; }>(`SELECT id, title, slug FROM events WHERE id = ANY($1::uuid[])`, [ids,],)
            .catch(() => ({ rows: [], }));
        return new Map(r.rows.map((e,) => [e.id, { title: e.title, url: `${base}/${e.slug}`, },],),);
    },
    activityKind: () => 'comments',
    needsApproval,
    onCountChange: (client, id, delta,) => threads.bump(client, 'event', id, delta,),
    reconcile: () => threads.reconcile('event',),
},);
