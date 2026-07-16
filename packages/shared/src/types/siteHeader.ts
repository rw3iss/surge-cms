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
    /** Text color used when the page/post selects the header's "alt" style.
     *  Falls back to `textColor` when empty. Only meaningful for
     *  text-rendering items (text / text_link / button / menu). */
    textColorAlt?: string;
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
    /** Alternate ("alt"/dark) background used when a page/post selects the
     *  header's alt style. Falls back to `backgroundColor` when empty. */
    backgroundColorAlt?: string;
    /** Alternate ("alt"/dark) text color used when a page/post selects the
     *  header's alt style. Falls back to `textColor` when empty. */
    textColorAlt?: string;
    /** Default header style for post pages (`default` | `alt`). A post can
     *  override it via its own `headerStyle`. */
    defaultPostHeaderStyle?: 'default' | 'alt';
    padding?: string;
    margin?: string;
    itemSpacing?: string;
    applyGutter?: boolean;
    /** Default font for the whole header — a font `customId` from the Font
     *  manager. Individual items override it. */
    defaultFont?: string;
    /** Default text size for the whole header (any CSS length, e.g. '16px').
     *  Individual items override it via their own `fontSize`. */
    defaultFontSize?: string;
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
