/**
 * Per-block-type email renderer registry. Each renderer returns just
 * the *cell content* (no `<tr><td>` wrapping). The orchestration in
 * `renderNode` wraps it in a styled `<tr><td>` with the block's
 * persisted `style` JSONB applied — padding, background, text color,
 * alignment, font size — so the cell always reflects the operator's
 * intent without each renderer having to reimplement style handling.
 *
 * Renderers can optionally return a struct with `cellStyle` overrides
 * (e.g. Spacer setting a hard cell height) or `rawRow` to opt out of
 * wrapping entirely (no current block uses rawRow, but it's there
 * for future use).
 */
import type { BlockType, TypographyDefaults, } from '@sitesurge/types';
import { cellStyleFromBlock, inlineStyle, } from './_util';
import { renderCampaign, } from './campaign';
import { renderCarousel, } from './carousel';
import { applyInlineRules, planCustomCss, } from './customCss';
import { renderDocument, } from './document';
import { renderEvent, } from './event';
import { renderForm, } from './form';
import { renderGroup, } from './group';
import { renderHero, } from './hero';
import { renderHtml, } from './html';
import { renderImage, } from './image';
import { renderPostList, } from './postList';
import { renderRichText, } from './richText';
import { renderSocial, } from './social';
import { renderSpacer, } from './spacer';
import { renderUrlLink, } from './urlLink';
import { renderVideo, } from './video';

export interface EmailBlockNode {
    id: string;
    blockType: string;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
    children: EmailBlockNode[];
}

export interface EmailRenderCtx {
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;
    fontFamily: string;
    textColor: string;
    bgColor: string;
    linkColor: string;
    /**
     * Rich-text heading/paragraph rhythm, resolved from Settings → Appearance.
     *
     * Carried on the context because email has no usable stylesheet: the
     * values must be inlined onto each tag, and the block renderers are the
     * only place that sees the tags.
     */
    typography: TypographyDefaults;
}

export interface BlockEmailRenderResult {
    /** Cell content. Wrapped in <tr><td style="..."> by renderNode. */
    content: string;
    /** Per-cell style overrides merged on top of the block.style-
     *  derived style. Used e.g. by Spacer to enforce a fixed height. */
    cellStyle?: Record<string, string>;
    /** Opt out: emit this verbatim (no wrapping). Reserved for future
     *  use — no current renderer needs it. */
    rawRow?: string;
}

export type BlockEmailRendererOut = string | BlockEmailRenderResult;
export type BlockEmailRenderer = (
    node: EmailBlockNode,
    ctx: EmailRenderCtx,
) => BlockEmailRendererOut;

/**
 * Render a container's children as rows of its own sub-table.
 *
 * Used by the block types whose content is resolved ahead of time
 * (`entity` / `template`). Emits nothing when nothing resolved, so an
 * unconfigured block doesn't leave an empty styled cell behind.
 */
const renderChildren: BlockEmailRenderer = (node, ctx,) => {
    const rows = node.children.map((c,) => renderNode(c, ctx,)).filter(Boolean,).join('\n',);
    if (!rows) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
};

export const RENDERERS: Record<BlockType, BlockEmailRenderer> = {
    rich_text: renderRichText,
    text: renderRichText,
    image: renderImage,
    url_link: renderUrlLink,
    spacer: renderSpacer,
    hero: renderHero,
    html: renderHtml,
    group: renderGroup,
    video: renderVideo,
    social: renderSocial,
    form: renderForm,
    campaign: renderCampaign,
    event: renderEvent,
    post: renderPostList,
    post_list: renderPostList,
    carousel: renderCarousel,
    document: renderDocument,
    // group_item is rendered inline by the parent group; calling it
    // directly is a no-op.
    group_item: () => '',
    // gallery is legacy (folded into image). Try the image renderer.
    gallery: renderImage,
    // `entity` and `template` don't carry content of their own — they point at
    // a content-block template (and, for `entity`, the record to bind). That
    // needs DB reads, which this synchronous emitter cannot do, so
    // `expandDynamicBlocks` resolves them into CHILDREN before rendering and
    // these arms simply emit that subtree. `renderNode` still wraps the result
    // in the block's own styled cell, so custom styles apply as they do
    // everywhere else. Both were `() => ''` — an entity block rendered as
    // nothing at all, with no indication why.
    entity: renderChildren,
    template: renderChildren,
};

function toResult(out: BlockEmailRendererOut,): BlockEmailRenderResult {
    return typeof out === 'string' ? { content: out, } : out;
}

/**
 * Render one block, wrapping it in a styled `<tr><td>` that applies
 * the block's persisted style. Per-renderer cellStyle (e.g. Spacer's
 * height) overrides defaults.
 */
export function renderNode(node: EmailBlockNode, ctx: EmailRenderCtx,): string {
    const fn = RENDERERS[node.blockType as BlockType];
    if (!fn) return '';
    const out = toResult(fn(node, ctx,),);
    if (out.rawRow !== undefined) return out.rawRow;
    if (!out.content) return '';

    /*
     * The operator's Custom CSS, split by what email can actually deliver:
     * declarations for the block go onto this cell, simple element rules go
     * onto the markup inside it, and the rest is left for the head <style>
     * (see buildEmailResponsiveCss). Merged LAST so it beats both the style
     * controls and the renderer's own cell style — the same precedence the web
     * gets from closing the block's cascade layer.
     */
    const custom = planCustomCss((node.style as { customCss?: string; } | undefined)?.customCss, '',);
    const content = applyInlineRules(out.content, custom.inline,);

    const style = { ...cellStyleFromBlock(node, ctx,), ...(out.cellStyle ?? {}), ...custom.cell, };
    const styleAttr = inlineStyle(style,);
    const styleStr = styleAttr ? ` style="${styleAttr}"` : '';
    // `data-block-id` lets the head `<style>` scope per-breakpoint @media rules
    // to this block (see buildEmailResponsiveCss).
    return `<tr><td data-block-id="${node.id}"${styleStr}>${content}</td></tr>`;
}
