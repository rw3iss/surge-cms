/** Small helpers shared by the media library page, its viewer and the select modal. */

export function formatSize(bytes: number,): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1,)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1,)} MB`;
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
