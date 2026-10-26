/**
 * The standard BRANDED email layout for every built-in (fallback) email:
 * the site logo centered on top linking home → the content → a footer with a
 * smaller logo, the site name and the site address.
 *
 * Used by the reply Default Template, the mail-purpose defaults
 * (`purposeDefaults.ts`), admin notifications (`notifications/format.ts`) and
 * the form "email" action. An operator-authored template (blocks) replaces it.
 *
 * Table-based, inline-styled (through `wrapEmailShell`), so it renders in
 * Outlook / Gmail / Apple Mail.
 */
import { escapeHtml, } from '../../utils/html';
import { wrapEmailShell, } from './shell';
import { loadMailRenderContext, type MailRenderContext, } from './siteContext';

export interface BrandLayout {
    siteName: string;
    siteUrl: string;
    /** Absolute URL of an email-safe logo, or null to show the site name. */
    logoUrl: string | null;
}

/**
 * The layout from a loaded mail context. `/logo.png` is the site-origin PNG of
 * Settings → Site Branding's logo (`routes/siteAssets.ts`) — the form Gmail
 * accepts; only offered when a logo is configured.
 */
export function brandLayoutFrom(ctx: Pick<MailRenderContext, 'siteName' | 'siteUrl' | 'siteSettings'>,): BrandLayout {
    const hasLogo = Boolean(ctx.siteSettings?.logo,);
    return {
        siteName: ctx.siteName,
        siteUrl: ctx.siteUrl,
        logoUrl: hasLogo && ctx.siteUrl ? `${ctx.siteUrl}/logo.png` : null,
    };
}

export async function brandLayout(): Promise<BrandLayout> {
    return brandLayoutFrom(await loadMailRenderContext(),);
}

const FONT = 'Arial,Helvetica,sans-serif';

function brand(layout: BrandLayout, height: number,): string {
    const home = escapeHtml(layout.siteUrl || '/',);
    const name = escapeHtml(layout.siteName,);
    return layout.logoUrl
        ? `<a href="${home}" style="text-decoration:none"><img src="${escapeHtml(layout.logoUrl,)}" alt="${name}" height="${height}" style="display:block;margin:0 auto;height:${height}px;width:auto;border:0"></a>`
        : `<a href="${home}" style="color:#111;font-family:${FONT};font-size:${Math.round(height / 2.6,)}px;font-weight:700;text-decoration:none">${name}</a>`;
}

/** The header row (logo, centered). */
export function brandHeaderRow(layout: BrandLayout,): string {
    return `<tr><td align="center" style="padding:28px 24px 8px">${brand(layout, 56,)}</td></tr>`;
}

/** The footer row (small logo, site name, site address). */
export function brandFooterRow(layout: BrandLayout,): string {
    const home = escapeHtml(layout.siteUrl || '/',);
    const host = escapeHtml((layout.siteUrl || '').replace(/^https?:\/\//, '',),);
    return `<tr><td align="center" style="padding:20px 24px 28px;border-top:1px solid #e5e7eb">`
        + brand(layout, 32,)
        + `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#6b7280">`
        + `${escapeHtml(layout.siteName,)}${host ? ` · <a href="${home}" style="color:#6b7280">${host}</a>` : ''}</p>`
        + `</td></tr>`;
}

export interface BrandedOptions {
    title?: string;
    preheader?: string;
}

/** Wrap card ROWS (`<tr>…</tr>`) in the branded shell: header row + rows + footer row. */
export function brandedEmail(rows: string, layout: BrandLayout, opts: BrandedOptions = {},): string {
    return wrapEmailShell({
        bodyHtml: brandHeaderRow(layout,) + rows + brandFooterRow(layout,),
        title: opts.title ?? layout.siteName,
        preheader: opts.preheader,
        bg: '#f4f4f5',
        font: FONT,
        color: '#222222',
        outerPadding: '32px 12px',
        innerBorder: '1px solid #e5e7eb',
        innerRadius: '8px',
    },);
}

/** Wrap a content HTML fragment (paragraphs, tables…) in the branded shell. */
export function brandedMessage(html: string, layout: BrandLayout, opts: BrandedOptions = {},): string {
    return brandedEmail(
        `<tr><td style="padding:16px 32px 24px;font-family:${FONT};font-size:15px;line-height:1.6;color:#222">${html}</td></tr>`,
        layout,
        opts,
    );
}

/** True when `html` is already a whole document (an operator pasted a full email). */
export function isFullHtmlDocument(html: string,): boolean {
    return /<html[\s>]|<!doctype/i.test(html,);
}
