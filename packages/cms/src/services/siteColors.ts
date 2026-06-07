/**
 * Site swatches service.
 *
 * Owns the canonical list of `SiteSwatch` entries used as both the
 * ColorPicker's preset palette AND the backing store for swatch
 * references (`swatch:{id}` color values throughout the app). Backed
 * by a Solid signal so any component reading `swatches()` re-renders
 * automatically when an admin edits the palette.
 *
 * The signal is the single source of truth — `services/colorResolver`
 * reads it to dereference `swatch:{id}` values, and AdminLayout /
 * public Layout read it to emit `--swatch-{id}` CSS custom properties
 * onto the layout root so SCSS-rendered DOM picks up changes live.
 *
 * IDs are URL-safe and stable: an 8-char random alphabet by default,
 * but the operator can override with a custom string (see
 * `isValidSwatchId`). The backend persists whatever IDs the client
 * sends after deduping.
 */
import type { SiteSwatch, } from '@rw/cms-shared';
import { createSignal, } from 'solid-js';
import { api, } from './api';

/**
 * Default palette used when the API hasn't responded yet OR returned
 * something invalid. Kept short and focused — operators are expected
 * to customize these via Settings → Appearance → Color Swatches.
 */
const DEFAULT_HEXES = [
    '#ffffff',
    '#000000',
    '#3498cf',
    '#1d3557',
    '#f1faee',
    '#457b9d',
    '#2a9d8f',
    '#e9c46a',
    '#f4a261',
    '#e76f51',
    '#264653',
    '#6b705c',
    '#a8dadc',
    '#ff006e',
    '#8338ec',
];

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** ID rules for both auto-generated and user-typed swatch IDs.
 *  Tightening this here keeps CSS custom-property names safe and makes
 *  the JSONB-text scan on the backend (`%swatch:{id}%`) trustworthy. */
const SWATCH_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;

export function isValidSwatchId(id: string,): boolean {
    return SWATCH_ID_RE.test(id,);
}

/** Generate a fresh random 8-char ID. Caller is responsible for
 *  ensuring uniqueness within the current swatch list. */
export function generateSwatchId(): string {
    let id = '';
    for (let i = 0; i < 8; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length,)];
    return id;
}

/** Generate a unique swatch ID not present in the supplied list. */
export function generateUniqueSwatchId(existing: ReadonlyArray<SiteSwatch>,): string {
    const taken = new Set(existing.map(s => s.id),);
    let id = generateSwatchId();
    while (taken.has(id,)) id = generateSwatchId();
    return id;
}

function buildDefaultSwatches(): SiteSwatch[] {
    return DEFAULT_HEXES.map((hex,) => ({ id: generateSwatchId(), hex, }));
}

/**
 * Best-effort coercion of whatever the API returned into `SiteSwatch[]`.
 * The backend already normalizes, so this is mostly a safety net for
 * legacy responses or hand-edited DBs.
 */
function normalize(raw: unknown,): SiteSwatch[] {
    if (!Array.isArray(raw,)) return buildDefaultSwatches();
    if (raw.length === 0) return [];

    // Object form (current shape).
    if (typeof raw[0] === 'object' && raw[0] !== null) {
        const seen = new Set<string>();
        return (raw as Array<Partial<SiteSwatch>>).flatMap((entry,) => {
            if (!entry || typeof entry.hex !== 'string') return [];
            let id = typeof entry.id === 'string' && SWATCH_ID_RE.test(entry.id,) ? entry.id : generateSwatchId();
            while (seen.has(id,)) id = generateSwatchId();
            seen.add(id,);
            const out: SiteSwatch = { id, hex: entry.hex, };
            if (typeof entry.name === 'string' && entry.name.trim()) out.name = entry.name.trim();
            return [out,];
        },);
    }

    // Legacy `string[]` shape — assign IDs client-side too in case the
    // backend hasn't migrated yet.
    return (raw as unknown[]).flatMap((c,) => {
        if (typeof c !== 'string') return [];
        return [{ id: generateSwatchId(), hex: c, },];
    },);
}

const [swatches, setSwatchesSignal,] = createSignal<SiteSwatch[]>([],);
let loadPromise: Promise<SiteSwatch[]> | null = null;
let loaded = false;

/**
 * Read the current swatch palette. Lazy-loads on first call; subsequent
 * calls return the cached signal value synchronously.
 */
export function getSwatches(): SiteSwatch[] {
    return swatches();
}

/** Reactive accessor for use inside Solid `createMemo` / `createEffect`. */
export { swatches, };

/** Trigger a load if we haven't yet. Safe to call repeatedly. */
export function loadSwatches(forceRefresh = false,): Promise<SiteSwatch[]> {
    if (loaded && !forceRefresh) return Promise.resolve(swatches(),);
    if (loadPromise && !forceRefresh) return loadPromise;
    loadPromise = (async () => {
        try {
            const response = await api.get('/settings/site-colors',);
            const data = response.success ? normalize((response as any).data,) : buildDefaultSwatches();
            setSwatchesSignal(data,);
            loaded = true;
            return data;
        } catch {
            const fallback = buildDefaultSwatches();
            setSwatchesSignal(fallback,);
            loaded = true;
            return fallback;
        }
    })();
    return loadPromise;
}

/** Persist a new swatch list. On success, the local signal is updated
 *  immediately so all consumers see the change without a refetch. */
export async function saveSwatches(next: SiteSwatch[],): Promise<boolean> {
    const response = await api.put('/settings/site-colors', next,);
    if (response.success) {
        // Trust the server's normalized echo over our local copy.
        const echoed = normalize((response as any).data,);
        setSwatchesSignal(echoed,);
        loaded = true;
        loadPromise = Promise.resolve(echoed,);
        return true;
    }
    return false;
}

/** Force a refetch from the server (e.g. after another tab edits). */
export async function reloadSwatches(): Promise<SiteSwatch[]> {
    loadPromise = null;
    loaded = false;
    return loadSwatches();
}

/** Lookup a swatch by ID. */
export function findSwatch(id: string,): SiteSwatch | undefined {
    return swatches().find(s => s.id === id);
}

/** Fetch the count of references to a swatch across the site. Used by
 *  the delete-confirm modal in the swatch editor. */
export interface SwatchUsageReport {
    total: number;
    breakdown: Array<{ source: string; count: number; }>;
}

export async function fetchSwatchUsages(id: string,): Promise<SwatchUsageReport> {
    try {
        const response = await api.get(`/settings/site-colors/usages/${encodeURIComponent(id,)}`,);
        if (response.success && (response as any).data) {
            const d = (response as any).data;
            return {
                total: typeof d.total === 'number' ? d.total : 0,
                breakdown: Array.isArray(d.breakdown,) ? d.breakdown : [],
            };
        }
    } catch {
        /* fall through to empty report */
    }
    return { total: 0, breakdown: [], };
}

// ─── Legacy hex-only access ─────────────────────────────────────────
//
// A few older call sites only need the list of hex values (e.g. the
// ColorPicker's static SSR fallback). Provide a thin accessor instead
// of forcing them all to learn the new shape immediately.

export const SITE_COLOR_DEFAULTS: ReadonlyArray<string> = DEFAULT_HEXES;
