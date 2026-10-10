/** Forum settings (`forum_settings`). */
import { DEFAULT_FORUM_SETTINGS, type ForumSettings, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import * as settingsService from '../settings';
import type { AuditContext, } from '../types';

export const SETTINGS_KEY = 'forum_settings';

export async function getSettings(): Promise<ForumSettings> {
    const raw = await settingsService.get<Partial<ForumSettings>>(SETTINGS_KEY,).catch(() => null);
    return { ...DEFAULT_FORUM_SETTINGS, ...(raw ?? {}), };
}

const int = (v: unknown, min: number, max: number, label: string,): number => {
    const n = Math.round(Number(v,),);
    if (!Number.isFinite(n,) || n < min || n > max) throw new ValidationError(`${label} must be ${min}–${max}.`,);
    return n;
};

export async function updateSettings(patch: Partial<ForumSettings>, ctx: AuditContext,): Promise<ForumSettings> {
    const n = { ...(await getSettings()), ...patch, };
    if (!['public', 'members', 'tier',].includes(n.readAccess,)) throw new ValidationError('Unknown read access.',);
    const next: ForumSettings = {
        title: String(n.title ?? '',).trim().slice(0, 120,) || 'Forum',
        description: String(n.description ?? '',).slice(0, 2000,),
        readAccess: n.readAccess,
        readMinRank: int(n.readMinRank, 0, 1000, 'Read tier',),
        threadMinRank: int(n.threadMinRank, 0, 1000, 'Start-thread tier',),
        replyMinRank: int(n.replyMinRank, 0, 1000, 'Reply tier',),
        approveAll: Boolean(n.approveAll,),
        approveUntil: int(n.approveUntil, 0, 100, 'Approve-until count',),
        threadsPerPage: int(n.threadsPerPage, 5, 100, 'Threads per page',),
        postsPerPage: int(n.postsPerPage, 5, 100, 'Posts per page',),
        showActivityCounts: Boolean(n.showActivityCounts,),
    };
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}
