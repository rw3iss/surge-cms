/**
 * Flag CSS in a custom-HTML block that email clients will not honour.
 *
 * A Custom HTML block is passed to the email VERBATIM, so whatever renders in
 * the admin preview — a browser, with a full CSS engine — is what gets posted
 * to an inbox that has far less of one. The failure is silent and partial,
 * which is the worst shape: a template keeps its inline styles and loses its
 * stylesheet, so the mail arrives recognisable but wrong, and the author has no
 * reason to suspect the template rather than the data.
 *
 * That is exactly how one newsletter shipped with its hero image at natural
 * size instead of `cover`, no dark scrim behind the headline, and a title at
 * the browser's default heading size — three separate rules, all of them in a
 * `<style>` block, all silently discarded.
 *
 * **This lints; it does not rewrite.** Inlining the inlinable subset was the
 * obvious alternative and is a trap: `background-size` and `padding` would
 * start working while a `::before` scrim and a `5cqi` font size still would
 * not, leaving a template that is *more* nearly right and just as silently
 * broken — harder to diagnose, not easier. Telling the author which
 * constructs cannot survive lets them choose an email-safe equivalent, which
 * is a decision about design, not a transformation a renderer can make.
 */
import { parseCssRules, parseDeclarations, } from '@sitesurge/types';

/** One thing about this HTML that email clients will not render faithfully. */
export interface EmailCssWarning {
    /** Stable identifier, for tests and for the UI to key on. */
    code: string;
    /** What will go wrong, in the author's terms. */
    message: string;
    /** The suggested email-safe replacement. */
    fix: string;
}

interface Rule {
    code: string;
    /** Must be global-free: `test()` on a /g regex is stateful. */
    match: RegExp;
    message: string;
    fix: string;
}

const RULES: Rule[] = [
    {
        code: 'style-block',
        match: /<style[\s>]/i,
        message: 'A <style> block is present. Gmail and several other clients strip stylesheets, ' +
            'so every rule in it is lost while inline styles survive.',
        fix: 'Move each declaration onto the element it targets as a style="…" attribute.',
    },
    {
        code: 'pseudo-element',
        match: /::?(before|after)\b/i,
        message: 'A ::before / ::after pseudo-element is used. It cannot be expressed as an inline ' +
            'style, so it disappears along with the stylesheet.',
        fix: 'For an overlay or scrim, layer a gradient into background-image on the element ' +
            'itself: background-image: linear-gradient(...), url(...).',
    },
    {
        code: 'container-query',
        match: /container-type\s*:|(?:^|[\s(,])\d*\.?\d+cq[iwhb]\b|\d*\.?\d+cqm(?:in|ax)\b/i,
        message: 'Container queries (container-type, or cqi/cqw/cqh units) are not supported by any ' +
            'email client.',
        fix: 'Use a fixed value sized for the email width (600px by default).',
    },
    {
        code: 'clamp',
        match: /\bclamp\s*\(/i,
        message: 'clamp() is unsupported in Outlook and several other clients.',
        fix: 'Resolve it to the single value it would produce at the email width.',
    },
    {
        code: 'flex-grid',
        match: /display\s*:\s*(flex|grid|inline-flex|inline-grid)\b/i,
        message: 'Flexbox and Grid are ignored by Outlook, which falls back to stacked blocks.',
        fix: 'Use a table, or accept the stacked fallback if the layout still reads.',
    },
    {
        code: 'gap',
        match: /(?:^|[;{\s])gap\s*:/i,
        message: 'gap only applies to flex/grid layouts, which Outlook does not support.',
        fix: 'Use margin or padding on the items instead.',
    },
    {
        code: 'css-variable',
        match: /var\s*\(\s*--/i,
        message: 'A CSS custom property (var(--…)) is used. The site stylesheet that defines it is ' +
            'not present in an inbox, so the fallback — or nothing — is what renders.',
        fix: 'Substitute the resolved value.',
    },
    {
        code: 'position',
        match: /position\s*:\s*(absolute|fixed|sticky)\b/i,
        message: 'Outlook ignores absolute, fixed and sticky positioning.',
        fix: 'Rely on normal flow, padding and tables for placement.',
    },
];

/**
 * Lint one block of operator-authored HTML.
 *
 * Returns at most one warning per rule: an author needs to know that a
 * `<style>` block is a problem, not how many selectors are inside it.
 */
export function lintEmailHtml(html: string,): EmailCssWarning[] {
    if (!html) return [];
    // Comments routinely DESCRIBE these constructs — including the ones this
    // very codebase writes explaining why a scrim is a gradient — and a lint
    // that fires on its own explanation trains people to ignore it.
    const code = html.replace(/<!--[\s\S]*?-->/g, '',);
    const out: EmailCssWarning[] = [];
    for (const rule of RULES) {
        if (rule.match.test(code,)) {
            out.push({ code: rule.code, message: rule.message, fix: rule.fix, },);
        }
    }
    return out;
}

/**
 * Block settings a Custom CSS declaration can silently take over.
 *
 * Both are the operator's own instructions, and the CSS legitimately wins —
 * a selector is more specific than a control, and that is the rule everywhere
 * else in this system. What it must not be is INVISIBLE: a setting that reads
 * `0px 0px 15px 15px` in the panel while the inbox shows `15px` looks like the
 * setting is broken, and the CSS that is actually responsible is in a
 * collapsed field on a different panel.
 *
 * Most of these rules are "email cannot do this". This one is "you asked for
 * the same thing twice, differently" — worth saying for exactly the case where
 * the CSS is a leftover workaround for a setting that has since been added.
 */
const SHADOWABLE: Array<{
    blockType: string;
    /** Key in the block's settings bag. */
    setting: string;
    /** What the operator sees on the panel. */
    label: string;
    /** The CSS property that overrides it. */
    property: string;
}> = [
    {
        blockType: 'social',
        setting: 'itemBorderRadius',
        label: 'Item border radius',
        property: 'border-radius',
    },
];

/** Every property a block's Custom CSS declares, across all its rules. */
function declaredProperties(customCss: string,): Set<string> {
    const out = new Set<string>();
    const walk = (css: string,) => {
        for (const rule of parseCssRules(css,)) {
            // An at-rule's body is a nested sheet, not declarations.
            if (rule.atRule) {
                walk(rule.body,);
                continue;
            }
            for (const prop of Object.keys(parseDeclarations(rule.body,),)) out.add(prop,);
        }
    };
    walk(customCss,);
    return out;
}

/** Warn where a block's Custom CSS takes over one of its own settings. */
function lintShadowedSettings(
    block: { blockType?: string; settings?: Record<string, unknown>; style?: Record<string, unknown>; },
): EmailCssWarning[] {
    const customCss = String(block.style?.customCss ?? '',);
    if (!customCss.trim()) return [];
    const declared = declaredProperties(customCss,);
    const out: EmailCssWarning[] = [];
    for (const s of SHADOWABLE) {
        if (block.blockType !== s.blockType) continue;
        const value = String(block.settings?.[s.setting] ?? '',).trim();
        if (!value || !declared.has(s.property,)) continue;
        out.push({
            code: `shadowed-${s.setting}`,
            message: `This block's Custom CSS sets ${s.property}, which overrides its "${s.label}" ` +
                `setting (${value}). The CSS wins, so the setting has no effect in the email.`,
            fix: `Remove the ${s.property} rule from the block's Custom CSS to use "${s.label}", ` +
                `or clear "${s.label}" if the CSS is what you want.`,
        },);
    }
    return out;
}

/**
 * Lint a rendered tree, de-duplicated by code.
 *
 * Two passes over different material: custom-HTML block CONTENT, which email
 * renders verbatim, and any block's Custom CSS, which can quietly take over a
 * setting on the same block.
 */
export function lintBlocksForEmail(
    blocks: Array<{ blockType?: string; settings?: Record<string, unknown>; style?: Record<string, unknown>; }>,
): EmailCssWarning[] {
    const seen = new Map<string, EmailCssWarning>();
    const add = (w: EmailCssWarning,) => {
        if (!seen.has(w.code,)) seen.set(w.code, w,);
    };
    for (const b of blocks) {
        for (const w of lintShadowedSettings(b,)) add(w,);
        if (b.blockType !== 'html') continue;
        const content = String(b.settings?.content ?? b.settings?.html ?? '',);
        for (const w of lintEmailHtml(content,)) add(w,);
    }
    return [...seen.values(),];
}
