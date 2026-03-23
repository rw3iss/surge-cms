export interface BlockStyle {
    id?: string; // UUID, undefined for custom/inline styles
    name?: string; // Template name, undefined for inline
    isDefault?: boolean; // Only one can be default
    backgroundColor?: string; // hex color
    textColor?: string; // hex color
    textAlign?: string; // 'left' | 'center' | 'right' | 'justify'
    verticalAlign?: string; // 'top' | 'center' | 'bottom'
    fontSize?: string; // e.g. '16px'
    width?: string; // CSS width value
    padding?: string; // CSS padding value
    margin?: string; // CSS margin value
    createdAt?: Date;
    updatedAt?: Date;
}

export interface BlockStyleReference {
    // Either a template reference OR inline custom styles
    templateId?: string; // Reference to saved block_styles.id
    custom?: BlockStyle; // Inline style overrides (no id/name)
}
