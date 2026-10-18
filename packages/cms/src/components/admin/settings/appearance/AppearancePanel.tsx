/** Settings → Appearance (site theme, layout, typography, swatches, fonts, breakpoints). */
import { createSignal, onMount, Show, } from 'solid-js';
import ColorPicker from '../../appearance/ColorPicker';
import FontManagerPanel from '../../appearance/FontManagerPanel';
import FontSelect from '../../common/FontSelect';
import { cms, } from '../../../../services/cmsClient';
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import type { SiteBreakpoint, } from '@sitesurge/types';
import { reloadSiteSettings, } from '../../../../stores/siteSettings';
import BreakpointsEditor, { POST_HEADER_BANNER_HEIGHT_TOOLTIP, } from './BreakpointsEditor';
import SiteColorsPanel from './SiteColorsPanel';
import ThemeField from './ThemeField';

export default function AppearancePanel() {
    // Colors
    const [backgroundColor, setBackgroundColor,] = createSignal('#ffffff',);
    const [textColor, setTextColor,] = createSignal('#1a1a1a',);
    const [primaryColor, setPrimaryColor,] = createSignal('#3498cf',);
    const [buttonTextColor, setButtonTextColor,] = createSignal('#ffffff',);
    const [linkColor, setLinkColor,] = createSignal('#3498cf',);
    const [headingColor, setHeadingColor,] = createSignal('#1a1a1a',);
    const [borderColor, setBorderColor,] = createSignal('#e5e7eb',);

    // Typography
    const [fontFamily, setFontFamily,] = createSignal('Inter, -apple-system, sans-serif',);
    const [headingFontFamily, setHeadingFontFamily,] = createSignal('Inter, -apple-system, sans-serif',);
    const [fontSize, setFontSize,] = createSignal(16,);
    const [headingWeight, setHeadingWeight,] = createSignal('700',);
    const [codeTabWidth, setCodeTabWidth,] = createSignal<'4' | '2' | 'tab'>('4',);
    const [lineHeight, setLineHeight,] = createSignal('1.5',);
    // Rich-text rhythm. Defaults read from the shared TYPOGRAPHY_DEFAULTS so the
    // form, the site CSS and the email inliner cannot drift apart.
    const [headingLineHeight, setHeadingLineHeight,] = createSignal(TYPOGRAPHY_DEFAULTS.headingLineHeight,);
    const [headingMargin, setHeadingMargin,] = createSignal(TYPOGRAPHY_DEFAULTS.headingMargin,);
    const [paragraphLineHeight, setParagraphLineHeight,] = createSignal(TYPOGRAPHY_DEFAULTS.paragraphLineHeight,);
    const [paragraphMargin, setParagraphMargin,] = createSignal(TYPOGRAPHY_DEFAULTS.paragraphMargin,);
    const [paragraphFontSize, setParagraphFontSize,] = createSignal(TYPOGRAPHY_DEFAULTS.paragraphFontSize,);
    // Miscellaneous. Empty = inherit the general Border Radius below it, so an
    // untouched site looks exactly as it did.
    const [buttonBorderRadius, setButtonBorderRadius,] = createSignal('',);

    // Layout
    const [gutterWidth, setGutterWidth,] = createSignal('',);
    const [pagePadding, setPagePadding,] = createSignal('',);
    const [postPadding, setPostPadding,] = createSignal('',);
    const [borderRadius, setBorderRadius,] = createSignal('',);
    const [maxContentWidth, setMaxContentWidth,] = createSignal('',);
    const [blockPadding, setBlockPadding,] = createSignal('',);
    const [postHeaderBannerHeight, setPostHeaderBannerHeight,] = createSignal('',);

    // Responsive breakpoints (managed list, persisted inside site_appearance)
    const [breakpoints, setBreakpoints,] = createSignal<SiteBreakpoint[]>([],);

    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    onMount(async () => {
        try {
            const d = await cms.settings.getAppearance() as any;
            if (d) {
                if (d.backgroundColor) setBackgroundColor(d.backgroundColor,);
                if (d.textColor) setTextColor(d.textColor,);
                if (d.primaryColor) setPrimaryColor(d.primaryColor,);
                if (d.buttonTextColor) setButtonTextColor(d.buttonTextColor,);
                if (d.linkColor) setLinkColor(d.linkColor,);
                if (d.headingColor) setHeadingColor(d.headingColor,);
                if (d.borderColor) setBorderColor(d.borderColor,);
                if (d.fontFamily) setFontFamily(d.fontFamily,);
                if (d.headingFontFamily) setHeadingFontFamily(d.headingFontFamily,);
                if (d.fontSize) setFontSize(d.fontSize,);
                if (d.headingWeight) setHeadingWeight(d.headingWeight,);
                if (d.codeTabWidth) setCodeTabWidth(d.codeTabWidth,);
                if (d.lineHeight) setLineHeight(d.lineHeight,);
                if (d.headingLineHeight) setHeadingLineHeight(d.headingLineHeight,);
                if (d.headingMargin) setHeadingMargin(d.headingMargin,);
                if (d.paragraphLineHeight) setParagraphLineHeight(d.paragraphLineHeight,);
                if (d.paragraphMargin) setParagraphMargin(d.paragraphMargin,);
                if (d.paragraphFontSize) setParagraphFontSize(d.paragraphFontSize,);
                if (d.buttonBorderRadius) setButtonBorderRadius(d.buttonBorderRadius,);
                if (d.gutterWidth) setGutterWidth(d.gutterWidth,);
                if (d.pagePadding) setPagePadding(d.pagePadding,);
                if (d.postPadding) setPostPadding(d.postPadding,);
                if (d.borderRadius) setBorderRadius(d.borderRadius,);
                if (d.maxContentWidth) setMaxContentWidth(d.maxContentWidth,);
                if (d.blockPadding) setBlockPadding(d.blockPadding,);
                if (d.postHeaderBannerHeight) setPostHeaderBannerHeight(d.postHeaderBannerHeight,);
                if (Array.isArray(d.breakpoints,)) setBreakpoints(d.breakpoints as SiteBreakpoint[],);
            }
        } catch (e) {
            console.error('Failed to load appearance:', e,);
        }
    },);

    const markDirty = () => { setIsDirty(true,); setSuccess(false,); };

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        setSuccess(false,);

        try {
            await cms.settings.appearance({
                backgroundColor: backgroundColor(),
                textColor: textColor(),
                primaryColor: primaryColor(),
                buttonTextColor: buttonTextColor(),
                linkColor: linkColor(),
                headingColor: headingColor(),
                borderColor: borderColor(),
                fontFamily: fontFamily(),
                headingFontFamily: headingFontFamily(),
                fontSize: fontSize(),
                headingWeight: headingWeight(),
                codeTabWidth: codeTabWidth(),
                lineHeight: lineHeight(),
                headingLineHeight: headingLineHeight(),
                headingMargin: headingMargin(),
                paragraphLineHeight: paragraphLineHeight(),
                paragraphMargin: paragraphMargin(),
                paragraphFontSize: paragraphFontSize(),
                buttonBorderRadius: buttonBorderRadius(),
                gutterWidth: gutterWidth() || undefined,
                pagePadding: pagePadding() || undefined,
                postPadding: postPadding() || undefined,
                borderRadius: borderRadius() || undefined,
                maxContentWidth: maxContentWidth() || undefined,
                blockPadding: blockPadding() || undefined,
                postHeaderBannerHeight: postHeaderBannerHeight() || undefined,
                // Drop incomplete rows (no name) so a half-added breakpoint
                // doesn't persist / show up in the block editor dropdown.
                breakpoints: breakpoints().filter((b,) => b.name.trim()),
            } as any,);

            // Appearance save also touches site_settings.site_appearance,
            // which the public settings endpoint includes. Refresh
            // the public settings store so the live Header / Footer
            // / SiteLogo pick up new colors / fonts immediately.
            await reloadSiteSettings();
            setIsDirty(false,);
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save appearance settings',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="appearance-panel">
            <div class="appearance-panel__action-bar">
                <button
                    class="ui-button ui-button--primary"
                    disabled={!isDirty() || saving()}
                    onClick={handleSave}
                >
                    {saving() ? 'Saving...' : 'Save Appearance'}
                </button>
                <Show when={success()}>
                    <span class="appearance-panel__saved">Saved.</span>
                </Show>
            </div>

            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{error()}</div>
            </Show>

            {/* ─── Colors + Color Swatches (two columns) ─── */}
            <div class="theme-columns">
            <div class="theme-section">
                <h4 class="theme-section__title">Colors</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Background"
                        sublabel="Page background color"
                        tooltip="The base background color for all pages on the site. Applied to the body element and inherited everywhere."
                    >
                        <ColorPicker value={backgroundColor()} onChange={(hex,) => { setBackgroundColor(hex,); markDirty(); }} clearable onClear={() => { setBackgroundColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Text Color"
                        sublabel="Default text color"
                        tooltip="The default color for paragraph text and unstyled elements. Override individual blocks via their style settings."
                    >
                        <ColorPicker value={textColor()} onChange={(hex,) => { setTextColor(hex,); markDirty(); }} clearable onClear={() => { setTextColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Heading Color"
                        sublabel="H1–H6 color"
                        tooltip="Color applied to all heading elements (H1 through H6) on the site. Defaults to the text color if not set."
                    >
                        <ColorPicker value={headingColor()} onChange={(hex,) => { setHeadingColor(hex,); markDirty(); }} clearable onClear={() => { setHeadingColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Primary / Brand"
                        sublabel="Brand accent color"
                        tooltip="The main brand/accent color used as the background of primary buttons, plus focus rings and progress indicators."
                    >
                        <ColorPicker value={primaryColor()} onChange={(hex,) => { setPrimaryColor(hex,); markDirty(); }} clearable onClear={() => { setPrimaryColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Button Text"
                        sublabel="Text color on buttons"
                        tooltip="The text/label color for buttons across the site. Sits on top of the Primary / Brand background. Defaults to white when unset."
                    >
                        <ColorPicker value={buttonTextColor()} onChange={(hex,) => { setButtonTextColor(hex,); markDirty(); }} clearable onClear={() => { setButtonTextColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Link Color"
                        sublabel="Hyperlink color"
                        tooltip="The color used for clickable text links on the public site. Defaults to the primary color if not set."
                    >
                        <ColorPicker value={linkColor()} onChange={(hex,) => { setLinkColor(hex,); markDirty(); }} clearable onClear={() => { setLinkColor('',); markDirty(); }} />
                    </ThemeField>

                    <ThemeField
                        label="Item Border Color"
                        sublabel="Cards, form fields, list items"
                        tooltip="Color applied to borders around card-style items throughout the site: blog post cards, form answer choices, textareas, and other bordered elements."
                    >
                        <ColorPicker value={borderColor()} onChange={(hex,) => { setBorderColor(hex,); markDirty(); }} clearable onClear={() => { setBorderColor('',); markDirty(); }} />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Color Swatches (right column) ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Color Swatches</h4>
                <p class="theme-section__description">
                    Manage the color swatches available throughout the admin color picker.
                </p>
                <SiteColorsPanel />
            </div>

            {/* ─── Miscellaneous (right column, under Color Swatches) ───
                A home for one-off appearance values that belong to no larger
                group. Without it each new knob either bloated Layout or was
                dropped somewhere arbitrary. */}
            <div class="theme-section">
                <h4 class="theme-section__title">Miscellaneous</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Button Border Radius"
                        sublabel="All site buttons"
                        tooltip="Corner radius for every button on the public site — header and footer button items, the standard button, and the sign-in / register / forgot-password / reset forms. Any CSS value: 6px, 0, 9999px for a pill. Empty inherits the general Border Radius. A header or footer button that sets its own radius still wins."
                    >
                        <input
                            type="text"
                            value={buttonBorderRadius()}
                            onInput={(e,) => { setButtonBorderRadius(e.currentTarget.value,); markDirty(); }}
                            placeholder="Inherit border radius"
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>
                </div>
            </div>
            </div>

            {/* ─── Typography + Layout (two columns) ─── */}
            <div class="theme-columns">
            <div class="theme-section">
                <h4 class="theme-section__title">Typography</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Body Font Family"
                        sublabel="Site-wide default font"
                        tooltip="Default font for paragraph and body text across the whole site. Pick an uploaded font (managed below); anything that sets its own font overrides this."
                    >
                        <div style={{ width: '320px', }}>
                            <FontSelect
                                value={fontFamily()}
                                onChange={(v,) => { setFontFamily(v,); markDirty(); }}
                                noneLabel="Default (theme font)"
                            />
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Heading Font Family"
                        sublabel="Font for H1–H6"
                        tooltip="Font used specifically for headings across the site. Falls back to the body font when unset."
                    >
                        <div style={{ width: '320px', }}>
                            <FontSelect
                                value={headingFontFamily()}
                                onChange={(v,) => { setHeadingFontFamily(v,); markDirty(); }}
                                noneLabel="Default (body font)"
                            />
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Base Font Size"
                        sublabel="Root rem unit (px)"
                        tooltip="The base font size in pixels. All rem-based sizing throughout the site scales from this value. Default: 16px."
                    >
                        <div class="u-flex-row">
                            <button class="ui-button ui-button--secondary ui-button--sm" onClick={() => { setFontSize(Math.max(10, fontSize() - 1,),); markDirty(); }}>-</button>
                            <span style={{ 'min-width': '40px', 'text-align': 'center', 'font-weight': '600', 'font-size': '0.875rem', }}>
                                {fontSize()}px
                            </span>
                            <button class="ui-button ui-button--secondary ui-button--sm" onClick={() => { setFontSize(Math.min(32, fontSize() + 1,),); markDirty(); }}>+</button>
                        </div>
                    </ThemeField>

                    <ThemeField
                        label="Heading Weight"
                        sublabel="100–900"
                        tooltip="The CSS font-weight applied to all headings. Common values: 400 (normal), 600 (semibold), 700 (bold), 800 (extrabold)."
                    >
                        <select
                            value={headingWeight()}
                            onChange={(e,) => { setHeadingWeight(e.currentTarget.value,); markDirty(); }}
                            class="theme-field__input"
                            style={{ width: '140px', }}
                        >
                            <option value="400">400 — Normal</option>
                            <option value="500">500 — Medium</option>
                            <option value="600">600 — Semibold</option>
                            <option value="700">700 — Bold</option>
                            <option value="800">800 — Extrabold</option>
                            <option value="900">900 — Black</option>
                        </select>
                    </ThemeField>

                    <ThemeField
                        label="Code Tab Width"
                        sublabel="What Tab inserts in code editors"
                        tooltip="Applies to every code editor in the admin — a page's Custom CSS and the Custom HTML block. One setting, so a document is not half tabs and half spaces depending on which screen it was edited from."
                    >
                        <select
                            value={codeTabWidth()}
                            onChange={(e,) => { setCodeTabWidth(e.currentTarget.value as never,); markDirty(); }}
                            class="theme-field__input"
                            style={{ width: '140px', }}
                        >
                            <option value="4">4 spaces</option>
                            <option value="2">2 spaces</option>
                            <option value="tab">Tab character</option>
                        </select>
                    </ThemeField>

                    <ThemeField
                        label="Line Height"
                        sublabel="Body text line spacing"
                        tooltip="Vertical space between lines of body text. Use a unitless multiplier like 1.5 (recommended) or a value with units."
                    >
                        <input
                            type="text"
                            value={lineHeight()}
                            onInput={(e,) => { setLineHeight(e.currentTarget.value,); markDirty(); }}
                            placeholder="1.5"
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Heading Line Height"
                        sublabel="H1–H6 in rich text"
                        tooltip="Line spacing for headings inside rich-text content, on the site AND in email. A DEFAULT: a block's own style, or an inline style on the element, still wins. Any CSS value — 1.15em, 1.2, 120%."
                    >
                        <input
                            type="text"
                            value={headingLineHeight()}
                            onInput={(e,) => { setHeadingLineHeight(e.currentTarget.value,); markDirty(); }}
                            placeholder={TYPOGRAPHY_DEFAULTS.headingLineHeight}
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Heading Margin"
                        sublabel="H1–H6 in rich text"
                        tooltip="Margin shorthand for headings inside rich-text content. Any CSS margin value — '10px 0px', '1rem 0', '10px 0 6px'."
                    >
                        <input
                            type="text"
                            value={headingMargin()}
                            onInput={(e,) => { setHeadingMargin(e.currentTarget.value,); markDirty(); }}
                            placeholder={TYPOGRAPHY_DEFAULTS.headingMargin}
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Paragraph Line Height"
                        sublabel="<p> in rich text"
                        tooltip="Line spacing for paragraphs inside rich-text content, on the site and in email. Body copy needs more leading than a heading."
                    >
                        <input
                            type="text"
                            value={paragraphLineHeight()}
                            onInput={(e,) => { setParagraphLineHeight(e.currentTarget.value,); markDirty(); }}
                            placeholder={TYPOGRAPHY_DEFAULTS.paragraphLineHeight}
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Paragraph Font Size"
                        sublabel="Body copy in rich text"
                        tooltip="Base font size for rich-text body copy — on the site, in the admin's block editor, and in email. Default 1rem, which is exactly the Base Font Size above. A block that sets its own font size still overrides this."
                    >
                        <input
                            type="text"
                            value={paragraphFontSize()}
                            onInput={(e,) => { setParagraphFontSize(e.currentTarget.value,); markDirty(); }}
                            placeholder={TYPOGRAPHY_DEFAULTS.paragraphFontSize}
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Paragraph Margin"
                        sublabel="<p> in rich text"
                        tooltip="Margin shorthand for paragraphs inside rich-text content. Any CSS margin value."
                    >
                        <input
                            type="text"
                            value={paragraphMargin()}
                            onInput={(e,) => { setParagraphMargin(e.currentTarget.value,); markDirty(); }}
                            placeholder={TYPOGRAPHY_DEFAULTS.paragraphMargin}
                            style={{ width: '140px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>
                </div>
            </div>

            {/* ─── Layout ─── */}
            <div class="theme-section">
                <h4 class="theme-section__title">Default Layout</h4>
                <div class="theme-section__fields">
                    <ThemeField
                        label="Site Gutter"
                        sublabel="Horizontal page padding"
                        tooltip="Horizontal padding applied to page content (posts, dynamic pages, donate, etc.). Header and carousel can opt in via their own settings. Use any CSS value: px, %, vw, em, rem."
                    >
                        <input
                            type="text"
                            value={gutterWidth()}
                            onInput={(e,) => { setGutterWidth(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 40px, 5%"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Page Padding"
                        sublabel="Top/bottom padding for pages that enable it"
                        tooltip="Vertical padding applied to the top and bottom of any page whose 'Apply Page Padding' toggle is on (default on). Kept separate from the Site Gutter so a page can take left/right gutter without vertical padding, or vice-versa. Default 0. Use any CSS padding value: '80px', '4rem 0', etc. Handy for pushing content below a floating header."
                    >
                        <input
                            type="text"
                            value={pagePadding()}
                            onInput={(e,) => { setPagePadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 80px, 4rem 0"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Post Padding"
                        sublabel="Padding for posts that enable it"
                        tooltip="Padding applied to any post whose 'Apply Post Padding' toggle is on (default on). Primarily top/bottom — the Site Gutter still handles left/right when its toggle is on. Default 0. Use any CSS padding value."
                    >
                        <input
                            type="text"
                            value={postPadding()}
                            onInput={(e,) => { setPostPadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 80px, 4rem 0"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Border Radius"
                        sublabel="Default rounding"
                        tooltip="Default corner radius applied via the --site-radius CSS variable. Components can opt in to use this for consistent rounding."
                    >
                        <input
                            type="text"
                            value={borderRadius()}
                            onInput={(e,) => { setBorderRadius(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 8px, 0.5rem"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Max Content Width"
                        sublabel="Maximum text/content width"
                        tooltip="Maximum width of constrained content blocks. Use 'none' for no constraint, or a CSS value like '1200px' or '70rem'."
                    >
                        <input
                            type="text"
                            value={maxContentWidth()}
                            onInput={(e,) => { setMaxContentWidth(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 1200px, 70rem"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Block Default Padding"
                        sublabel="Default padding for all blocks"
                        tooltip="Default padding applied to all content blocks on pages and posts. Overridden by any custom block style padding. Use any CSS value like '1rem', '20px', or shorthand like '1rem 2rem'."
                    >
                        <input
                            type="text"
                            value={blockPadding()}
                            onInput={(e,) => { setBlockPadding(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 1rem, 20px"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>

                    <ThemeField
                        label="Post Header Banner Height"
                        sublabel="Static height for post hero banners"
                        tooltip={POST_HEADER_BANNER_HEIGHT_TOOLTIP}
                    >
                        <input
                            type="text"
                            value={postHeaderBannerHeight()}
                            onInput={(e,) => { setPostHeaderBannerHeight(e.currentTarget.value,); markDirty(); }}
                            placeholder="e.g. 220px, 40vh"
                            style={{ width: '200px', }}
                            class="theme-field__input"
                        />
                    </ThemeField>
                </div>
            </div>
            </div>

            {/* ─── Breakpoints ─── (owns its own grid: 1 col idle, 2 cols editing) */}
            <BreakpointsEditor
                value={breakpoints()}
                onChange={(bps,) => { setBreakpoints(bps,); markDirty(); }}
            />

            {/* ─── Font manager ─── */}
            <FontManagerPanel />
        </div>
    );
}
