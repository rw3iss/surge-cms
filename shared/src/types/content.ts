export type ContentAccessLevel = 'public' | 'member' | 'patron';

export type PageStatus = 'draft' | 'published' | 'archived';

export interface Page {
    id: string;
    slug: string;
    title: string;
    description?: string;
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string[];
    ogImage?: string;
    status: PageStatus;
    isHomepage: boolean;
    showInNav: boolean;
    navOrder: number;
    isPrivate: boolean;
    accessLevel?: ContentAccessLevel;
    blocks: Block[];
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export type BlockType =
    | 'rich_text'
    | 'post'
    | 'form'
    | 'image'
    | 'video'
    | 'gallery'
    | 'social_feed'
    | 'campaign'
    | 'hero'
    | 'html';

export interface Block {
    id: string;
    pageId: string;
    type: BlockType;
    title?: string;
    content?: string;
    settings: BlockSettings;
    order: number;
    isVisible: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface BlockSettings {
    postId?: string;
    formId?: string;
    campaignId?: string;
    socialPlatform?: SocialPlatform;
    socialPostIds?: string[];
    mediaIds?: string[];
    layout?: 'full' | 'contained' | 'wide';
    backgroundColor?: string;
    textColor?: string;
    padding?: string;
    customClasses?: string;
    [key: string]: unknown;
}

export type PostStatus = 'draft' | 'published' | 'archived';

export interface Post {
    id: string;
    slug: string;
    title: string;
    excerpt?: string;
    content: string;
    featuredImage?: string;
    author: string;
    authorId: string;
    status: PostStatus;
    isPrivate: boolean;
    accessLevel?: ContentAccessLevel;
    tags: string[];
    categories: string[];
    metaTitle?: string;
    metaDescription?: string;
    publishedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export type SocialPlatform =
    | 'patreon'
    | 'youtube'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'tiktok';

export interface SocialPost {
    id: string;
    platform: SocialPlatform;
    externalId: string;
    content?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    authorName?: string;
    authorAvatar?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    publishedAt: Date;
    fetchedAt: Date;
    rawData: Record<string, unknown>;
}

export interface Media {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    alt?: string;
    caption?: string;
    uploadedBy: string;
    createdAt: Date;
}

export interface NavigationItem {
    id: string;
    label: string;
    slug: string;
    isExternal: boolean;
    url?: string;
    order: number;
    isVisible: boolean;
    requiresAuth: boolean;
}

export interface AppearanceSettings {
    // Colors
    backgroundColor?: string;
    textColor?: string;
    primaryColor?: string;
    linkColor?: string;
    headingColor?: string;
    borderColor?: string;
    // Typography
    fontFamily?: string;
    headingFontFamily?: string;
    fontSize?: number;
    headingWeight?: string;
    lineHeight?: string;
    // Layout
    gutterWidth?: string;
    borderRadius?: string;
    maxContentWidth?: string;
    blockPadding?: string;
}

export interface SiteSettings {
    siteName: string;
    siteDescription: string;
    logo?: string;
    favicon?: string;
    socialLinks: Record<SocialPlatform, string>;
    contactEmail: string;
    analytics?: {
        googleAnalyticsId?: string;
        facebookPixelId?: string;
    };
    theme?: {
        primaryColor: string;
        secondaryColor: string;
        accentColor: string;
    };
    appearance?: AppearanceSettings;
}
