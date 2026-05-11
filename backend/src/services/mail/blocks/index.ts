/**
 * Per-block-type email renderer registry. Each renderer returns an
 * HTML fragment containing one or more `<tr>` rows (the outer
 * `<table>` is added by `services/mail/renderer.ts`).
 *
 * Renderers are pure: they receive a fully-resolved block + the
 * rendering context and produce a string. No DB calls; no async. Any
 * dynamic block (e.g. post_list) must denormalize its data into
 * settings before render time.
 */
import { renderRichText, } from './richText';
import { renderImage, } from './image';
import { renderUrlLink, } from './urlLink';
import { renderSpacer, } from './spacer';
import { renderHero, } from './hero';
import { renderHtml, } from './html';
import { renderGroup, } from './group';
import { renderVideo, } from './video';
import { renderSocial, } from './social';
import { renderForm, } from './form';
import { renderCampaign, } from './campaign';
import { renderPostList, } from './postList';
import { renderCarousel, } from './carousel';
import { renderDocument, } from './document';

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
}

export type BlockEmailRenderer = (node: EmailBlockNode, ctx: EmailRenderCtx,) => string;

export const RENDERERS: Record<string, BlockEmailRenderer> = {
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
    post: renderPostList,
    post_list: renderPostList,
    carousel: renderCarousel,
    document: renderDocument,
    // group_item is rendered inline by the parent group; calling it
    // directly is a no-op.
    group_item: () => '',
    // gallery is legacy (folded into image). Try the image renderer.
    gallery: renderImage,
};

export function renderNode(node: EmailBlockNode, ctx: EmailRenderCtx,): string {
    const fn = RENDERERS[node.blockType];
    if (!fn) return '';
    return fn(node, ctx,);
}
