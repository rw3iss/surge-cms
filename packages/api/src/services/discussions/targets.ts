/**
 * Comment TARGETS: what a comment can be attached to. Each feature registers
 * its own (Comments → `post`, `event`; Forum → `forum_thread`), so the engine
 * never imports a feature. Every read and write goes through `access()`, which
 * is how gated content can never leak through its comments.
 */
import type { PoolClient, } from 'pg';
import type { CommentTargetRef, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import type { FeatureKey, } from '../../features/registry';
import { isFeatureEnabledServer, } from '../settings';
import type { Viewer, } from './viewer';

export type ActivityKind = 'comments' | 'forum_threads' | 'forum_replies';

export interface TargetAccess {
    title: string;
    url: string;
    /** May this viewer read the item's comments (published + passes its gate). */
    canRead: boolean;
    /** Is commenting open on the item (enabled, not locked). Permission is checked separately. */
    canComment: boolean;
    allowAnonymous: boolean;
    /** Why commenting is closed / reading refused, for the UI. */
    reason?: string;
}

export interface CommentTarget {
    type: string;
    /** The feature that must be on for this target to work at all. */
    feature: FeatureKey;
    /** Permission a signed-in user needs to post here. */
    writePermission: string;
    /** null = no such item, or it is not visible to this viewer at all. */
    access(targetId: string, viewer: Viewer,): Promise<TargetAccess | null>;
    /** Titles + URLs for comments shown away from their item (profile, moderation). */
    summaries(ids: string[],): Promise<Map<string, { title: string; url: string; }>>;
    /** Which activity counter a visible comment here feeds. */
    activityKind(isOpening: boolean,): ActivityKind;
    /** Should a new comment start `pending`? */
    needsApproval?(viewer: Viewer, isGuest: boolean,): Promise<boolean>;
    /** Keep the target's own counters in step — runs inside the write transaction. */
    onCountChange?(client: PoolClient, targetId: string, delta: number, comment: { isOpening: boolean; createdAt: Date; authorId: string | null; },): Promise<void>;
    /** Nightly: recompute the target's counters from the comment rows. */
    reconcile?(): Promise<void>;
}

const registry = new Map<string, CommentTarget>();

export function registerCommentTarget(t: CommentTarget,): void {
    registry.set(t.type, t,);
}

export function allTargets(): CommentTarget[] {
    return [...registry.values(),];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `post:<uuid>` → parts. */
export function parseTarget(ref: string,): { type: string; id: string; } {
    const i = ref.indexOf(':',);
    const type = i > 0 ? ref.slice(0, i,) : '';
    const id = i > 0 ? ref.slice(i + 1,) : '';
    if (!type || !UUID.test(id,)) throw new ValidationError('target must be "<type>:<uuid>"',);
    return { type, id, };
}

/** The registered target, refusing one whose feature is off (as if it did not exist). */
export async function getTarget(type: string,): Promise<CommentTarget> {
    const t = registry.get(type,);
    if (!t || !(await isFeatureEnabledServer(t.feature,))) throw new NotFoundError('Comments',);
    return t;
}

/** Like getTarget, but null instead of throwing (for mixed lists). */
export async function findTarget(type: string,): Promise<CommentTarget | null> {
    return getTarget(type,).catch(() => null);
}

export const targetRef = (type: string, id: string,): CommentTargetRef => `${type}:${id}`;
