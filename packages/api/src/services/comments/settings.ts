/** Comments-feature settings (`comments_settings`). */
import { type CommentsSettings, DEFAULT_COMMENTS_SETTINGS, } from '@sitesurge/types';
import * as settingsService from '../settings';
import type { AuditContext, } from '../types';

export const SETTINGS_KEY = 'comments_settings';

export async function getSettings(): Promise<CommentsSettings> {
    const raw = await settingsService.get<Partial<CommentsSettings>>(SETTINGS_KEY,).catch(() => null);
    return { ...DEFAULT_COMMENTS_SETTINGS, ...(raw ?? {}), };
}

export async function updateSettings(patch: Partial<CommentsSettings>, ctx: AuditContext,): Promise<CommentsSettings> {
    const cur = await getSettings();
    const next: CommentsSettings = {
        approveAnonymous: patch.approveAnonymous ?? cur.approveAnonymous,
        approveAll: patch.approveAll ?? cur.approveAll,
        notifyOnReply: patch.notifyOnReply ?? cur.notifyOnReply,
        enableByDefault: patch.enableByDefault ?? cur.enableByDefault,
    };
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}
