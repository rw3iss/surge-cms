export { sanitize, } from '../../../utils/sanitize';

export function escapeHtml(s: unknown,): string {
    if (s === null || s === undefined) return '';
    return String(s,)
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&#39;',);
}

export function isoToReadable(iso: string | null | undefined,): string {
    if (!iso) return '';
    try {
        const d = new Date(iso,);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', },);
    } catch {
        return '';
    }
}
