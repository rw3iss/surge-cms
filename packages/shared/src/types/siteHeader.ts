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
    /** Font for this item — a font `customId` from the Font manager. Empty
     *  inherits the header default (or the site font). Only meaningful for
     *  text-rendering items (text / text_link / button / menu). */
    fontFamily?: string;
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
    textColor?: string;
    padding?: string;
    margin?: string;
    itemSpacing?: string;
    applyGutter?: boolean;
    /** Default font for the whole header — a font `customId` from the Font
     *  manager. Individual items override it. */
    defaultFont?: string;
    /** Pin the header to the viewport top (position: sticky). Default true. */
    sticky?: boolean;
    /** Slide the header out of view on downward scroll, back in on up. */
    autoHide?: boolean;
    /** Float the header absolutely on top of the page content (transparent
     *  overlay) instead of sitting in flow above it. Lets content render
     *  underneath a background-less header. */
    floatHeader?: boolean;
    /** Absolutely position the right-side content (cart / admin / user /
     *  logout) within the header so it doesn't push the main header content
     *  left — keeps centered header content actually centered. */
    floatRightContent?: boolean;
    /** Show the shopping-cart link in the header (only when the `shop`
     *  feature is enabled). Default true. */
    showCart?: boolean;
    /** How the logged-in account controls render on desktop:
     *  - `inline` (default): Admin link + user name + logout, in a row.
     *  - `menu`: a gear icon that opens a dropdown with those items. */
    loggedInFormat?: 'inline' | 'menu';
}
