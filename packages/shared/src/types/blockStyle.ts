export interface BlockStyle {
    id?: string; // UUID, undefined for custom/inline styles
    name?: string; // Template name, undefined for inline
    isDefault?: boolean; // Only one can be default
    backgroundColor?: string; // hex color
    /** Background image URL. When set, it renders over the background color
     *  (the image wins visually) and covers the block's full box — content
     *  is inset by `padding`, the image is not clipped by it. */
    backgroundImage?: string;
    textColor?: string; // hex color
    textAlign?: string; // 'left' | 'center' | 'right' | 'justify'
    verticalAlign?: string; // 'top' | 'center' | 'bottom'
    fontSize?: string; // e.g. '16px'
    lineHeight?: string; // e.g. '1.5' (unitless) or '24px'
    width?: string; // CSS width value
    height?: string; // CSS height value
    padding?: string; // CSS padding value
    margin?: string; // CSS margin value
    gap?: string; // CSS gap value
    overflowX?: string; // CSS overflow-x value
    overflowY?: string; // CSS overflow-y value
    createdAt?: Date;
    updatedAt?: Date;
}

export interface BlockStyleReference {
    // Either a template reference OR inline custom styles
    templateId?: string; // Reference to saved block_styles.id
    custom?: BlockStyle; // Inline style overrides (no id/name)
}
