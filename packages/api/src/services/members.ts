/**
 * Public member pages (`/members/:handle`): the profile card and the member's
 * comments + forum posts across the site.
 *
 * Privacy: a hidden page (`profile_public = false`) 404s for everyone but the
 * member and staff. Comments are filtered per TARGET through the engine's
 * `access()`, so a comment on a gated post or a private forum category never
 * appears here for a viewer who could not read it in place.
 */
import type { CommentWithTarget, MemberProfile, UserActivity, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { NotFoundError, } from '../core/errors';
import { query, } from '../db';
import { isFeatureEnabledServer, } from './settings';
import { ensureHandle, } from './handles';

interface Viewer { id?: string | null; role?: string | null; }

const ZERO: UserActivity = { comments: 0, forumThreads: 0, forumReplies: 0, total: 0, lastActiveAt: null, };

interface UserRow {
    id: string; handle: string | null; display_name: string; avatar_url: string | null; role: string;
    created_at: Date; bio: string | null; profile_public: boolean; is_active: boolean; is_banned: boolean; tier: string | null;
}

async function discussionsOn(): Promise<boolean> {
    return isFeatureEnabledServer('discussions',).catch(() => false);
}

/** The user behind a handle, honouring visibility. */
async function findVisible(handle: string, viewer: Viewer,): Promise<UserRow> {
    const r = await query<UserRow>(
        `SELECT u.id, u.handle, u.display_name, u.avatar_url, u.role, u.created_at, u.bio, u.profile_public,
                u.is_active, u.is_banned,
                (SELECT sp.name FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
                  WHERE s.user_id = u.id AND s.status = ANY(ARRAY['active','trialing','past_due'])
                  ORDER BY sp.sort_order DESC LIMIT 1) AS tier
           FROM users u WHERE lower(u.handle) = lower($1)`,
        [handle,],
    );
    const u = r.rows[0];
    if (!u || !u.is_active || u.is_banned) throw new NotFoundError('Member',);
    const self = Boolean(viewer.id,) && viewer.id === u.id;
    if (!u.profile_public && !self && !isStaffRole(viewer.role ?? undefined,)) throw new NotFoundError('Member',);
    return u;
}

export async function profile(handle: string, viewer: Viewer,): Promise<MemberProfile> {
    const u = await findVisible(handle, viewer,);
    const on = await discussionsOn();
    let activity = ZERO;
    if (on) {
        const { activity: act, } = await import('./discussions/index.js');
        activity = await act.getActivity(u.id,).catch(() => ZERO);
    }
    return {
        id: u.id,
        handle: u.handle ?? (await ensureHandle(u.id,)),
        name: u.display_name,
        avatarUrl: u.avatar_url,
        joinedAt: new Date(u.created_at,).toISOString(),
        role: isStaffRole(u.role,) ? u.role : null,
        tierName: u.tier,
        bio: u.bio,
        activity,
        commentsEnabled: on,
        hidden: !u.profile_public,
    };
}

/**
 * The member's VISIBLE comments + forum posts, newest first, each with the
 * item it is on. Pages over the raw rows and drops what the viewer may not
 * read, so a page can come back shorter than `limit` — `total` counts the
 * unfiltered rows (an upper bound), which is what makes "Load more" honest.
 */
export async function comments(handle: string, viewer: Viewer, opts: { page?: number; limit?: number; } = {},): Promise<{ items: CommentWithTarget[]; total: number; page: number; limit: number; }> {
    if (!(await discussionsOn())) throw new NotFoundError('Comments',);
    const u = await findVisible(handle, viewer,);
    const page = Math.max(1, opts.page ?? 1,);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20,),);

    const engine = await import('./discussions/index.js');
    const { AUTHOR_JOIN, COMMENT_COLUMNS, excerptOf, } = await import('./discussions/rows.js');
    type Row = import('./discussions/rows').CommentRow;

    const where = `c.author_id = $1 AND c.status = 'visible'`;
    const total = Number((await query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM comments c WHERE ${where}`, [u.id,],)).rows[0]?.n ?? 0,);
    const rows = (await query<Row>(
        `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN} WHERE ${where}
          ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        [u.id,],
    )).rows;

    // Per-target access, resolved once per item in this request.
    const access = new Map<string, boolean>();
    const visible: Row[] = [];
    for (const r of rows) {
        const key = `${r.target_type}:${r.target_id}`;
        if (!access.has(key,)) {
            const t = await engine.findTarget(r.target_type,);
            const a = t ? await t.access(r.target_id, viewer,).catch(() => null) : null;
            access.set(key, Boolean(a?.canRead,),);
        }
        if (access.get(key,)) visible.push(r,);
    }

    const summaries = await engine.moderation.targetSummaries(visible,);
    const mapped = await engine.comments.mapForViewer(visible, viewer,);
    const items: CommentWithTarget[] = mapped.map((c, i,) => ({
        ...c,
        target: summaries.get(`${visible[i].target_type}:${visible[i].target_id}`,) ?? null,
        excerpt: excerptOf(visible[i].body,),
    }));
    return { items, total, page, limit, };
}
