/**
 * Engine-wide discussion settings (`discussions_settings`): reactions, body
 * length, edit window. Shared by Comments and the Forum.
 */
import { DEFAULT_DISCUSSIONS_SETTINGS, type DiscussionsSettings, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import * as settingsService from '../settings';
import type { AuditContext, } from '../types';

export const SETTINGS_KEY = 'discussions_settings';

export async function getSettings(): Promise<DiscussionsSettings> {
    const raw = await settingsService.get<Partial<DiscussionsSettings>>(SETTINGS_KEY,).catch(() => null);
    return { ...DEFAULT_DISCUSSIONS_SETTINGS, ...(raw ?? {}), };
}

export async function updateSettings(patch: Partial<DiscussionsSettings>, ctx: AuditContext,): Promise<DiscussionsSettings> {
    const next = { ...(await getSettings()), ...patch, };
    if (!Array.isArray(next.reactions,)) throw new ValidationError('reactions must be a list',);
    next.reactions = [...new Set(next.reactions.map((r,) => String(r,).trim()).filter(Boolean,),),];
    if (next.reactions.length > 12 || next.reactions.some((r,) => r.length > 16)) {
        throw new ValidationError('Up to 12 reactions, each at most 16 characters.',);
    }
    next.maxLength = Math.round(Number(next.maxLength,),);
    if (!(next.maxLength >= 100 && next.maxLength <= 50_000)) throw new ValidationError('Max length must be 100–50 000.',);
    next.editWindowMinutes = Math.max(0, Math.round(Number(next.editWindowMinutes,) || 0,),);
    next.reactionsEnabled = Boolean(next.reactionsEnabled,);
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}
