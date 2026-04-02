export interface HeroCarouselSettings {
    items: HeroItem[];
    options: HeroCarouselOptions;
}

export interface HeroItem {
    id: string;
    mediaId: string;
    mediaUrl: string;
    mediaThumbnailUrl?: string;
    mediaType: 'image' | 'video';
    objectFit: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    autoplay?: boolean;
    header?: HeroTextConfig;
    subheader?: HeroTextConfig;
    action?: HeroActionConfig;
    order: number;
}

export interface HeroTextConfig {
    text: string;
    size: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    color: string;
}

export type HeroButtonSize = 'small' | 'normal' | 'large';

export interface HeroActionConfig {
    label: string;
    url: string;
    openInNewTab: boolean;
    size?: HeroButtonSize;
}

export interface HeroCarouselOptions {
    autoScroll: boolean;
    autoScrollInterval: number;
    repeat: boolean;
    customHeight: boolean;
    height: string;
    applyGutter?: boolean;
}
