/** Small helpers shared by the media library page, its viewer, the modals and the gallery admin. */
import { formatFileSize, } from '@sitesurge/types';

/** `532 B`, `4.2 KB`, `1.3 GB` — the ONE size formatter for media UI (GB/TB aware). */
export function formatSize(bytes: number | null | undefined,): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes,),)) return '—';
    return formatFileSize(Number(bytes,),);
}

export function getTypeLabel(mimeType: string,): string {
    if (mimeType?.startsWith('image/',)) return 'Image';
    if (mimeType?.startsWith('video/',)) return 'Video';
    if (mimeType?.startsWith('audio/',)) return 'Audio';
    return 'Document';
}

export function downloadFile(url: string, filename: string,) {
    const a = document.createElement('a',);
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a,);
    a.click();
    document.body.removeChild(a,);
}
