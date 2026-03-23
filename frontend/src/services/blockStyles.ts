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
    padding?: string;
    margin?: string;
}

/**
 * Default block style values.
 * Edit these to change the baseline styles for all new blocks.
 */
export const BLOCK_STYLE_DEFAULTS: Required<
    Pick<
        BlockStyleData,
        'backgroundColor' | 'textColor' | 'textAlign' | 'verticalAlign' | 'fontSize' | 'width' | 'padding' | 'margin'
    >
> = {
    backgroundColor: '#ffffff',
    textColor: '#000000',
    textAlign: 'left',
    verticalAlign: 'top',
    fontSize: '16px',
    width: '100%',
    padding: '0px',
    margin: '0px',
};

let cachedStyles: BlockStyleData[] | null = null;

export const BlockStyleService = {
    /** Returns the cached styles synchronously (empty if not yet loaded) */
    getCached(): BlockStyleData[] {
        return cachedStyles || [];
    },

    async getAll(): Promise<BlockStyleData[]> {
        if (cachedStyles) return cachedStyles;
        const res = await api.get('/block-styles',);
        if (res.success) {
            cachedStyles = (res as any).data || [];
            return cachedStyles!;
        }
        return [];
    },

    invalidateCache() {
        cachedStyles = null;
    },

    async create(data: Partial<BlockStyleData>,): Promise<BlockStyleData | null> {
        // Ensure defaults are filled in for any missing values
        const payload = { ...BLOCK_STYLE_DEFAULTS, ...data, };
        const res = await api.post('/block-styles', payload,);
        if (res.success) {
            this.invalidateCache();
            return (res as any).data;
        }
        return null;
    },

    async update(id: string, data: Partial<BlockStyleData>,): Promise<BlockStyleData | null> {
        const res = await api.put(`/block-styles/${id}`, data,);
        if (res.success) {
            this.invalidateCache();
            return (res as any).data;
        }
        return null;
    },

    async remove(id: string,): Promise<boolean> {
        const res = await api.delete(`/block-styles/${id}`,);
        if (res.success) {
            this.invalidateCache();
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
            padding: style.padding || BLOCK_STYLE_DEFAULTS.padding,
            margin: style.margin || BLOCK_STYLE_DEFAULTS.margin,
        };
    },
};
