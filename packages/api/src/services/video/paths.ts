/**
 * Every object key and URL the video feature uses, in one place.
 *
 *   incoming/<sessionId>/<name>                — a direct upload in progress / awaiting encode
 *   originals/<mediaId>/source<ext>            — a kept original (deleted after retention)
 *   video/<mediaId>/<encodeId>-<secret>/…      — the FULL video: <rung>/index.m3u8 + seg_*.ts,
 *                                                downloads/<rung>.mp4, poster.jpg, sprites
 *   video/<mediaId>/<encodeId>-teaser/…        — the TEASER (never encrypted)
 *
 * The full prefix carries a random secret, so knowing the (public) teaser path
 * or the media id does not reveal where the full video lives. Every encode
 * gets a new encodeId, so every object path is written once → immutable cache.
 */
import { customAlphabet, } from '../../utils/nanoid';
import { config, } from '../../config';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10,);
const secret = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24,);

export const newEncodeId = (): string => id();

export function sanitizeFilename(name: string,): string {
    const base = name.split(/[\\/]/,).pop() || 'file';
    const clean = base.normalize('NFKD',).replace(/[^\w.-]+/g, '-',).replace(/-+/g, '-',).replace(/^[-.]+/, '',);
    return (clean || 'file').slice(-120,);
}

export const incomingKey = (sessionId: string, filename: string,): string => `incoming/${sessionId}/${sanitizeFilename(filename,)}`;

export function originalKey(mediaId: string, filename: string,): string {
    const m = /\.[A-Za-z0-9]{1,8}$/.exec(filename,);
    return `originals/${mediaId}/source${m ? m[0].toLowerCase() : ''}`;
}

export function fullPrefix(mediaId: string, encodeId: string,): string {
    return `video/${mediaId}/${encodeId}-${secret()}`;
}

export const teaserPrefix = (mediaId: string, encodeId: string,): string => `video/${mediaId}/${encodeId}-teaser`;

/** Everything a media row owns under video/ (prefix delete on remove). */
export const mediaVideoRoot = (mediaId: string,): string => `video/${mediaId}/`;

export const renditionPlaylistKey = (prefix: string, rung: string,): string => `${prefix}/${rung}/index.m3u8`;
export const renditionDir = (prefix: string, rung: string,): string => `${prefix}/${rung}`;
export const downloadKey = (prefix: string, rung: string,): string => `${prefix}/downloads/${rung}.mp4`;
export const posterKey = (prefix: string,): string => `${prefix}/poster.jpg`;
export const posterThumbKey = (prefix: string,): string => `${prefix}/poster_thumb.jpg`;
export const spritesVttKey = (prefix: string,): string => `${prefix}/sprites/thumbnails.vtt`;
export const spriteImageKey = (prefix: string, n: number,): string => `${prefix}/sprites/sprite_${n}.jpg`;

/** Public origin of the API (the site). */
export function siteBase(): string {
    return config.frontendUrl.replace(/\/+$/, '',);
}

/** The video module's mount (separate from /media so a disabled feature's
 *  404 guard never shadows the media routes). */
const API = '/api/v1/video';

export const masterUrl = (mediaId: string,): string => `${siteBase()}${API}/${mediaId}/master.m3u8`;
export const teaserMasterUrl = (mediaId: string,): string => `${siteBase()}${API}/${mediaId}/teaser.m3u8`;
export const downloadUrl = (mediaId: string, quality: string,): string =>
    `${siteBase()}${API}/${mediaId}/download?quality=${encodeURIComponent(quality,)}`;

/** Key URI baked into encrypted playlists. Absolute: a relative URI would
 *  resolve against the playlist's CDN host. */
export function keyUri(version: number, keyBaseUrl: string,): string {
    return `${(keyBaseUrl || siteBase()).replace(/\/+$/, '',)}${API}/hls-key/${version}`;
}
