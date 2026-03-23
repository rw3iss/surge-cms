export type HeaderItemType = 'image' | 'image_link' | 'text' | 'text_link' | 'button' | 'menu' | 'gap' | 'flex_spacer';

export interface SiteHeaderItem {
    id: string;
    type: HeaderItemType;
    text?: string;
    url?: string;
    imageUrl?: string;
    mediaId?: string;
    openInNewTab?: boolean;
    buttonColor?: string;
    fontSize?: string;
    textColor?: string;
    width?: string;
    alignment?: string; // 'left' | 'center' | 'right'
    margin?: string;
    padding?: string;
    order: number;
    children?: SiteHeaderItem[]; // For 'menu' type sub-items
}

export interface SiteHeaderSettings {
    items: SiteHeaderItem[];
    backgroundColor?: string;
    padding?: string;
    margin?: string;
    itemSpacing?: string;
}
