/**
 * Post types — server-side validation of `posts.post_type` + `type_settings`.
 *
 * The registry itself is shared (`@sitesurge/types` utils/postTypes.ts) so the
 * server and the SPA agree on which keys exist. This module only decides what
 * a write may store:
 *   - `postType` must be a registered key (else 400 listing the valid ones),
 *   - `typeSettings` is merged over the type's `settingsDefaults`, and for a
 *     `live` post the known keys are type-checked (unknown keys are kept —
 *     a site-registered type may carry anything).
 */
import type { LiveChatMode, PostTypeDefinition, } from '@sitesurge/types';
import { getPostType, isPostType, listPostTypes, } from '@sitesurge/types';
import { ValidationError, } from '../core/errors';

export const LIVE_CHAT_MODES: readonly LiveChatMode[] = ['off', 'public', 'members', 'subscribers',];

export function list(): PostTypeDefinition[] {
    return listPostTypes();
}

export function validKeys(): string[] {
    return listPostTypes().map((t,) => t.key);
}

/** Throws a 400 naming the valid keys when `key` is not a registered type. */
export function assertPostType(key: unknown,): string {
    if (typeof key !== 'string' || !isPostType(key,)) {
        throw new ValidationError(`Unknown post type "${String(key,)}". Valid types: ${validKeys().join(', ',)}`, {
            field: 'postType',
            validTypes: validKeys(),
        },);
    }
    return key;
}

/** Validate the known keys of a live post's settings. Throws ValidationError. */
function checkLive(s: Record<string, unknown>,): void {
    const bad = (field: string, msg: string,) => {
        throw new ValidationError(`typeSettings.${field}: ${msg}`, { field: `typeSettings.${field}`, },);
    };
    if ('archiveVideo' in s && typeof s.archiveVideo !== 'boolean') bad('archiveVideo', 'must be a boolean',);
    if ('reactionsEnabled' in s && typeof s.reactionsEnabled !== 'boolean') bad('reactionsEnabled', 'must be a boolean',);
    if ('muted' in s && typeof s.muted !== 'boolean') bad('muted', 'must be a boolean',);
    if ('chatMode' in s && !LIVE_CHAT_MODES.includes(s.chatMode as LiveChatMode,)) {
        bad('chatMode', `must be one of ${LIVE_CHAT_MODES.join(', ',)}`,);
    }
    for (const k of ['provider', 'providerRoomId',]) {
        if (k in s && s[k] !== null && typeof s[k] !== 'string') bad(k, 'must be a string or null',);
    }
}

/**
 * The `type_settings` to store: the type's defaults, then `existing` (only
 * when the type is unchanged), then the incoming `patch`.
 */
export function resolveTypeSettings(
    type: string,
    patch: unknown,
    existing?: Record<string, unknown> | null,
): Record<string, unknown> {
    if (patch !== undefined && patch !== null && (typeof patch !== 'object' || Array.isArray(patch,))) {
        throw new ValidationError('typeSettings must be an object', { field: 'typeSettings', },);
    }
    const def = getPostType(type,);
    const merged = {
        ...(def.settingsDefaults ?? {}),
        ...(existing ?? {}),
        ...((patch as Record<string, unknown> | null) ?? {}),
    };
    if (type === 'live') checkLive(merged,);
    return merged;
}
