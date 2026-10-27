/**
 * Who may read / write / delete which posts in the ADMIN — staff (editor,
 * admin, sysadmin) as before, plus non-staff users holding the `posts:*_own`
 * permissions (contributors), limited to posts they wrote. And what a
 * contributor's save may change: author forced to themselves, gating and live
 * shows staff-only, and "publish" in `approval` mode becomes `pending_review`.
 *
 * Every route that a role admin shell opens (`admin/shells` in the SPA) goes
 * through here; entering the shell grants nothing by itself.
 */
import { isStaffRole, } from '@sitesurge/types';
import { query, } from '../db';
import { ForbiddenError, NotFoundError, UnauthorizedError, } from '../core/errors';
import { checkMode, scopeFor, } from './permissions';

export interface PostActor { id?: string; role?: string; }
export type PostScope = 'any' | 'own';

/**
 * The actor's scope for `action`, and — with `postId` — proof the post is
 * theirs when the scope is `own` (else 404, so ids cannot be probed).
 */
export async function postAccess(
    user: PostActor | undefined,
    action: 'read' | 'write' | 'delete',
    postId?: string,
    apiKey?: unknown,
): Promise<PostScope> {
    // An API key is an admin-equivalent machine client (its scope was checked by the tier).
    if (apiKey) return 'any';
    if (!user?.id) throw new UnauthorizedError('Sign in first.',);
    // Staff keep exactly today's behaviour (the staff tier was the whole check).
    if (isStaffRole(user.role,)) return 'any';
    const scope = await scopeFor({ id: user.id, role: user.role, }, 'posts', action,);
    if (!scope) throw new ForbiddenError('You do not have permission to do this.',);
    if (scope === 'own' && postId) {
        const r = await query<{ author_id: string | null; }>(`SELECT author_id FROM posts WHERE id = $1`, [postId,],);
        if (!r.rows[0] || r.rows[0].author_id !== user.id) throw new NotFoundError('Post',);
    }
    return scope;
}

/**
 * Map a requested status through the writer's `posts:publish` MODE — for every
 * person (any scope, staff too): allow → as asked; approval → `pending_review`
 * (+ `submitted`); deny → draft. API keys are not shaped (admin-equivalent).
 * Refuses changing a published post when publishing needs approval.
 */
export async function shapeStatus(
    user: PostActor & { id: string; },
    body: Record<string, unknown>,
    current: { status: string; } | null,
): Promise<{ body: Record<string, unknown>; submitted: boolean; }> {
    const out: Record<string, unknown> = { ...body, };
    const mode = await checkMode({ id: user.id, role: user.role, }, 'posts:publish',);
    if (mode === 'allow') {
        // Anyone may still choose "Waiting for review" — that is a submission too
        // (the team is alerted: notification "Content submissions").
        const submitted = out.status === 'pending_review' && current?.status !== 'pending_review';
        return { body: out, submitted, };
    }
    if (current && (current.status === 'published' || current.status === 'scheduled')) {
        throw new ForbiddenError('This post is published — ask an editor to change it.',);
    }
    let submitted = false;
    const wanted = out.status as string | undefined;
    if (wanted === 'published' || wanted === 'scheduled' || wanted === 'pending_review') {
        if (mode === 'approval') {
            out.status = 'pending_review';
            out.publishAt = null;
            submitted = current?.status !== 'pending_review';
        } else {
            out.status = 'draft';
        }
    }
    return { body: out, submitted, };
}

/** Fields only staff (or `any`-scope users) may set. */
const STAFF_ONLY_FIELDS = ['authorId', 'requiredTierId', 'gateHidden', 'gateShowSample', 'gateSamplePercent', 'publishedAt',] as const;

/**
 * Shape an OWN-scope save (a contributor): author = them, no gating fields, no
 * live shows, and the requested status mapped through their `posts:publish`
 * mode — allow → as asked; approval → `pending_review` (+ submitted_at);
 * deny → draft. Editing a published post is refused unless they may publish.
 */
export async function shapeOwnPostWrite(
    user: PostActor & { id: string; },
    body: Record<string, unknown>,
    current: { status: string; } | null,
): Promise<{ body: Record<string, unknown>; submitted: boolean; }> {
    const out: Record<string, unknown> = { ...body, };
    for (const f of STAFF_ONLY_FIELDS) delete out[f];
    if (!current) out.authorId = user.id;
    if (out.postType === 'live') throw new ForbiddenError('Live shows are created by staff.',);

    // Own drafts are deleted, not archived/trashed by a contributor.
    if (out.status === 'archived' || out.status === 'deleted') out.status = 'draft';
    return shapeStatus(user, out, current,);
}

export async function postStatus(id: string,): Promise<{ status: string; authorId: string | null; title: string; } | null> {
    const r = await query<{ status: string; author_id: string | null; title: string; }>(`SELECT status, author_id, title FROM posts WHERE id = $1`, [id,],);
    return r.rows[0] ? { status: r.rows[0].status, authorId: r.rows[0].author_id, title: r.rows[0].title, } : null;
}
