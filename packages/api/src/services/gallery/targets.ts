/**
 * Comments on gallery items (`gallery_item:<id>`). Registered under the
 * Comments feature (guests need `comments:anonymous`, which lives there) and
 * refused while the Gallery feature is off. Reading follows the item's gate;
 * whether commenting is open follows the item's switch, else the gallery's.
 */
import { registerCommentTarget, } from '../discussions/targets';
import { isStaffViewer, } from '../discussions/viewer';
import { getSettings as getCommentsSettings, } from '../comments/settings';
import * as threads from '../comments/threads';
import { isFeatureEnabledServer, } from '../settings';
import { get, } from './items';
import { getSettings, } from './settings';

const pick = (sw: 'inherit' | 'on' | 'off', fallback: boolean,) => (sw === 'inherit' ? fallback : sw === 'on');

registerCommentTarget({
    type: 'gallery_item',
    feature: 'comments',
    writePermission: 'gallery:comment',
    async access(id, viewer,) {
        if (!(await isFeatureEnabledServer('gallery',))) return null;
        const staff = isStaffViewer(viewer,);
        const item = await get(id, staff ? { audience: 'admin', } : { viewer, },);
        if (!item || (!staff && !item.media)) return null;
        const s = await getSettings();
        const thread = await threads.get('gallery_item', id,);
        const enabled = pick(item.comments, s.commentsEnabled,);
        const base = { title: item.title || 'Gallery item', url: item.url, canRead: true, };
        if (!enabled) return { ...base, canComment: false, allowAnonymous: false, reason: 'Comments are off for this item.', };
        if (thread.locked) return { ...base, canComment: false, allowAnonymous: false, reason: 'Comments are closed.', };
        return { ...base, canComment: true, allowAnonymous: pick(item.anonymousComments, s.allowAnonymousComments,), };
    },
    async summaries(ids,) {
        const out = new Map<string, { title: string; url: string; }>();
        for (const id of ids) {
            const item = await get(id, { audience: 'admin', },);
            if (item) out.set(id, { title: item.title || 'Gallery item', url: item.url, },);
        }
        return out;
    },
    activityKind: () => 'comments',
    async needsApproval(_viewer, isGuest,) {
        const s = await getCommentsSettings();
        return s.approveAll || (isGuest && s.approveAnonymous);
    },
    async resolveThread(id, stored,) {
        const item = await get(id, { audience: 'admin', },);
        if (!item || !(await isFeatureEnabledServer('gallery',))) return { ...stored, enabled: false, allowAnonymous: false, };
        const s = await getSettings();
        return { ...stored, enabled: pick(item.comments, s.commentsEnabled,), allowAnonymous: pick(item.anonymousComments, s.allowAnonymousComments,), };
    },
    onCountChange: (client, id, delta,) => threads.bump(client, 'gallery_item', id, delta,),
    reconcile: () => threads.reconcile('gallery_item',),
},);
