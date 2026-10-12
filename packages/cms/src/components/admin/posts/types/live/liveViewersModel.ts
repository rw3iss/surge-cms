/**
 * Pure helpers for the live console's Viewers panel (`LiveViewers.tsx`):
 * grouping sockets into people, ordering, search and the time labels.
 * Kept free of Solid + the DOM so they are unit-testable.
 */
import type { LiveViewer, LiveViewerKey, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';

/** One PERSON in the room — every socket that shares a viewer key. */
export interface ViewerGroup {
    key: LiveViewerKey;
    /** The longest-connected socket's details (name, avatar, role…). */
    viewer: LiveViewer;
    /** Open sockets (tabs/devices) for this key. */
    connections: number;
    /** Earliest `connectedAt` across the sockets (ms). */
    connectedAt: number;
    staff: boolean;
    muted: boolean;
    /** Latest silence end across the sockets (ms), or null. */
    silencedUntil: number | null;
}

const ms = (iso: string | null | undefined,): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso,);
    return Number.isFinite(t,) ? t : null;
};

/** Collapse sockets into one entry per viewer key. */
export function groupViewers(list: LiveViewer[],): ViewerGroup[] {
    const map = new Map<LiveViewerKey, ViewerGroup>();
    for (const v of list) {
        const at = ms(v.connectedAt,) ?? Date.now();
        const until = ms(v.silencedUntil,);
        const g = map.get(v.key,);
        if (!g) {
            map.set(v.key, {
                key: v.key,
                viewer: v,
                connections: 1,
                connectedAt: at,
                staff: !v.anonymous && isStaffRole(v.role ?? undefined,),
                muted: v.muted,
                silencedUntil: until,
            },);
            continue;
        }
        g.connections += 1;
        if (at < g.connectedAt) { g.connectedAt = at; g.viewer = v; }
        g.muted = g.muted || v.muted;
        if (until !== null && (g.silencedUntil === null || until > g.silencedUntil)) g.silencedUntil = until;
        g.staff = g.staff || (!v.anonymous && isStaffRole(v.role ?? undefined,));
    }
    return [...map.values(),];
}

/** 0 = staff, 1 = signed in, 2 = guest. */
const rank = (g: ViewerGroup,): number => (g.staff ? 0 : g.viewer.anonymous ? 2 : 1);

/** Staff first, then signed-in members, then guests; longest-connected first within each. */
export function sortViewers(groups: ViewerGroup[],): ViewerGroup[] {
    return groups.toSorted((a, b,) => rank(a,) - rank(b,) || a.connectedAt - b.connectedAt || a.key.localeCompare(b.key,));
}

/** Case-insensitive match on name or handle (a leading `@` is ignored). */
export function filterViewers(groups: ViewerGroup[], query: string,): ViewerGroup[] {
    const q = query.trim().replace(/^@/, '',).toLowerCase();
    if (!q) return groups;
    return groups.filter((g,) =>
        g.viewer.name.toLowerCase().includes(q,) || (g.viewer.handle ?? '').toLowerCase().includes(q,)
    );
}

/** Still silenced at `now`? */
export const isSilenced = (g: ViewerGroup, now: number,): boolean => g.silencedUntil !== null && g.silencedUntil > now;

/** Remaining silence as `m:ss` (or `h:mm:ss`); '' when not silenced. */
export function formatCountdown(until: number | null, now: number,): string {
    if (until === null) return '';
    const left = Math.max(0, Math.ceil((until - now) / 1000,),);
    if (left <= 0) return '';
    const h = Math.floor(left / 3600,);
    const m = Math.floor((left % 3600) / 60,);
    const s = left % 60;
    const ss = String(s,).padStart(2, '0',);
    return h > 0 ? `${h}:${String(m,).padStart(2, '0',)}:${ss}` : `${m}:${ss}`;
}

/** Short "connected for" label: `12s`, `3m`, `1h 5m`. */
export function formatConnectedFor(since: number, now: number,): string {
    const sec = Math.max(0, Math.floor((now - since) / 1000,),);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60,);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60,);
    const rem = min % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Initial for the avatar placeholder. */
export const initialOf = (name: string,): string => (name.trim()[0] ?? '?').toUpperCase();
