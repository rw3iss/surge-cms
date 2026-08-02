export interface BlockStyle {
    id?: string; // UUID, undefined for custom/inline styles
    name?: string; // Template name, undefined for inline
    isDefault?: boolean; // Only one can be default
    backgroundColor?: string; // hex color
    /** Background image URL. When set, it renders over the background color
     *  (the image wins visually) and covers the block's full box — content
     *  is inset by `padding`, the image is not clipped by it. */
    backgroundImage?: string;
    /** CSS background-position for the background image (e.g. 'center',
     *  'center center', 'center 100%', 'top left'). Defaults to 'center'. */
    backgroundPosition?: string;
    textColor?: string; // hex color
    textAlign?: string; // 'left' | 'center' | 'right' | 'justify'
    verticalAlign?: string; // 'top' | 'center' | 'bottom'
    /** Horizontal alignment of the block's item row (justify-content):
     *  'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly' | 'stretch'. */
    horizontalAlign?: string;
    /** Font — a font `customId` from the Font manager; empty inherits the site
     *  font. Persisted for saved templates via the `font_family` column. */
    fontFamily?: string;
    fontSize?: string; // e.g. '16px'
    lineHeight?: string; // e.g. '1.5' (unitless) or '24px'
    width?: string; // CSS width value
    maxWidth?: string; // CSS max-width value (same value space as width)
    minHeight?: string; // CSS min-height value
    height?: string; // CSS height value
    padding?: string; // CSS padding value
    margin?: string; // CSS margin value
    gap?: string; // CSS gap value
    overflowX?: string; // CSS overflow-x value
    overflowY?: string; // CSS overflow-y value
    /** Per-breakpoint style overrides, keyed by `SiteBreakpoint.id`. Each entry
     *  holds only the presentation props that differ at that breakpoint (a prop
     *  absent = inherit the base/default style; `null` = explicitly cleared).
     *  Rendered as scoped `@media` rules; absent/empty = no responsive styles.
     *  Applies to both per-block inline styles and saved templates. */
    breakpoints?: Record<string, BlockStyleOverride>;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * A single breakpoint's override bag: CSS-prop (a `BlockStyle` presentation key
 * like `padding`, `margin`, `backgroundColor`, …) → value. `null` means the
 * prop is explicitly cleared at that breakpoint. Kept loose (string values) to
 * match how the style→CSS mapper already consumes a style bag.
 */
export type BlockStyleOverride = Record<string, string | null>;

export interface BlockStyleReference {
    // Either a template reference OR inline custom styles
    templateId?: string; // Reference to saved block_styles.id
    custom?: BlockStyle; // Inline style overrides (no id/name)
}
