import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

/**
 * Document → download-link card. Email clients won't preview the file,
 * but the operator wants a one-click download.
 */
export const renderDocument: BlockEmailRenderer = (node,) => {
    const url = String(node.settings.url ?? node.settings.fileUrl ?? '#',);
    const name = String(node.settings.fileName ?? node.settings.title ?? node.settings.url ?? 'Document',);
    const size = node.settings.fileSize ? ` (${formatBytes(Number(node.settings.fileSize,),)})` : '';
    return `<a href="${escapeHtml(url,)}" style="display:inline-block;padding:10px 16px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;text-decoration:none;color:#333">
        📄 ${escapeHtml(name,)}${size}
    </a>`;
};

function formatBytes(bytes: number,): string {
    if (!Number.isFinite(bytes,) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB',];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 0 : 1,)} ${units[i]}`;
}
