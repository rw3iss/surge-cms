import { createSignal, } from 'solid-js';
import { cms, } from './cmsClient';

export interface BlockStyleData {
    id?: string;
    name?: string;
    isDefault?: boolean;
    backgroundColor?: string;
    /** Background image URL. Renders over the background color and covers the
     *  block's full box; content is inset by `padding`, the image is not. */
    backgroundImage?: string;
    textColor?: string;
    textAlign?: string;
    verticalAlign?: string;
    /** Font — a font `customId` from the Font manager. Empty inherits the
     *  site font. */
    fontFamily?: string;
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
        'backgroundColor' | 'backgroundImage' | 'textColor' | 'textAlign' | 'verticalAlign' | 'fontFamily' | 'fontSize' | 'width' | 'height' | 'padding' | 'margin' | 'gap' | 'overflowX' | 'overflowY'
    >
> = {
    backgroundColor: '',
    backgroundImage: '',
    textColor: '',
    textAlign: 'left',
    verticalAlign: 'top',
    fontFamily: '',
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
            try {
                const list = (await cms.blockStyles.list()) as unknown as BlockStyleData[];
                setStyles(Array.isArray(list,) ? list : [],);
            } catch {
                setStyles([],);
            }
            pending = null;
            return styles();
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
        try {
            const created = await cms.blockStyles.create(payload as any,);
            this.invalidateCache();
            void this.getAll();
            return created as unknown as BlockStyleData;
        } catch {
            return null;
        }
    },

    async update(id: string, data: Partial<BlockStyleData>,): Promise<BlockStyleData | null> {
        try {
            const updated = await cms.blockStyles.update(id, data as any,);
            this.invalidateCache();
            void this.getAll();
            return updated as unknown as BlockStyleData;
        } catch {
            return null;
        }
    },

    async remove(id: string,): Promise<boolean> {
        try {
            await cms.blockStyles.remove(id,);
            this.invalidateCache();
            void this.getAll();
            return true;
        } catch {
            return false;
        }
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
            backgroundImage: style.backgroundImage || BLOCK_STYLE_DEFAULTS.backgroundImage,
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
