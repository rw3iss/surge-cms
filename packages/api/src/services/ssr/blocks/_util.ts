export { sanitize, } from '../../../utils/sanitize';
export { escapeHtml, } from '../../../utils/html';

export function isoToReadable(iso: string | null | undefined,): string {
    if (!iso) return '';
    try {
        const d = new Date(iso,);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', },);
    } catch {
        return '';
    }
}
