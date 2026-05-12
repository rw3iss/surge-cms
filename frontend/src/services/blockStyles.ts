import { createSignal, } from 'solid-js';
import { api, } from './api';

export interface BlockStyleData {
    id?: string;
    name?: string;
    isDefault?: boolean;
    backgroundColor?: string;
    textColor?: string;
    textAlign?: string;
    verticalAlign?: string;
    fontSize?: string;
    width?: string;
    height?: string;
    padding?: string;
    margin?: string;
    gap?: string;
    overflowX?: string;
    overflowY?: string;
}

/**
 * Default block style values.
 * Edit these to change the baseline styles for all new blocks.
 */
export const BLOCK_STYLE_DEFAULTS: Required<
    Pick<
        BlockStyleData,
        'backgroundColor' | 'textColor' | 'textAlign' | 'verticalAlign' | 'fontSize' | 'width' | 'height' | 'padding' | 'margin' | 'gap' | 'overflowX' | 'overflowY'
    >
> = {
    backgroundColor: '',
    textColor: '',
    textAlign: 'left',
    verticalAlign: 'top',
    fontSize: '',
    width: '100%',
    height: '',
    padding: '',
    margin: '',
    gap: '',
    overflowX: '',
    overflowY: '',
};

// Reactive cache. BlockPreview (and any other renderer) reads the
// styles synchronously via `getCached()` — which now goes through the
// signal — so once `preload()` populates the cache, every consumer
// re-renders with the resolved template props on the next tick.
// Previously the cache was a plain variable, so a block referencing a
// style template would render with no style on first paint until some
// other interaction (e.g. clicking the block) happened to trigger a
// re-evaluation. With the signal there's no longer that race.
const [styles, setStyles,] = createSignal<BlockStyleData[]>([],);
let pending: Promise<BlockStyleData[]> | null = null;

export const BlockStyleService = {
    /** Returns the cached styles synchronously. Inside a reactive scope
     *  (e.g. a JSX expression in BlockPreview), this subscribes to
     *  cache changes so the consumer re-renders when preload finishes. */
    getCached(): BlockStyleData[] {
        return styles();
    },

    async getAll(): Promise<BlockStyleData[]> {
        if (styles().length > 0) return styles();
        if (pending) return pending;
        pending = (async () => {
            const res = await api.get('/block-styles',);
            const list = res.success ? ((res as any).data || []) : [];
            setStyles(list,);
            pending = null;
            return list;
        })();
        return pending;
    },

    /** Idempotent fire-and-forget loader. Editors call this on mount so
     *  the cache is populated before any block renders for the first
     *  time. */
    preload(): void { void this.getAll(); },

    invalidateCache() {
        setStyles([],);
        pending = null;
    },

    async create(data: Partial<BlockStyleData>,): Promise<BlockStyleData | null> {
        // Ensure defaults are filled in for any missing values
        const payload = { ...BLOCK_STYLE_DEFAULTS, ...data, };
        const res = await api.post('/block-styles', payload,);
        if (res.success) {
            this.invalidateCache();
            void this.getAll();
            return (res as any).data;
        }
        return null;
    },

    async update(id: string, data: Partial<BlockStyleData>,): Promise<BlockStyleData | null> {
        const res = await api.put(`/block-styles/${id}`, data,);
        if (res.success) {
            this.invalidateCache();
            void this.getAll();
            return (res as any).data;
        }
        return null;
    },

    async remove(id: string,): Promise<boolean> {
        const res = await api.delete(`/block-styles/${id}`,);
        if (res.success) {
            this.invalidateCache();
            void this.getAll();
            return true;
        }
        return false;
    },

    /** Returns a fresh copy of the default style values */
    getDefault(): BlockStyleData {
        return { ...BLOCK_STYLE_DEFAULTS, };
    },

    /** Fills in defaults for any null/undefined properties on a style */
    withDefaults(style: BlockStyleData,): BlockStyleData {
        return {
            ...style,
            backgroundColor: style.backgroundColor || BLOCK_STYLE_DEFAULTS.backgroundColor,
            textColor: style.textColor || BLOCK_STYLE_DEFAULTS.textColor,
            textAlign: style.textAlign || BLOCK_STYLE_DEFAULTS.textAlign,
            verticalAlign: style.verticalAlign || BLOCK_STYLE_DEFAULTS.verticalAlign,
            fontSize: style.fontSize || BLOCK_STYLE_DEFAULTS.fontSize,
            width: style.width || BLOCK_STYLE_DEFAULTS.width,
            height: style.height || BLOCK_STYLE_DEFAULTS.height,
            padding: style.padding || BLOCK_STYLE_DEFAULTS.padding,
            margin: style.margin || BLOCK_STYLE_DEFAULTS.margin,
            gap: style.gap || BLOCK_STYLE_DEFAULTS.gap,
            overflowX: style.overflowX || BLOCK_STYLE_DEFAULTS.overflowX,
            overflowY: style.overflowY || BLOCK_STYLE_DEFAULTS.overflowY,
        };
    },
};
