export function formatCurrency(cents: number, currency = 'USD',): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    },).format(cents / 100,);
}

export function formatNumber(num: number,): string {
    return new Intl.NumberFormat('en-US',).format(num,);
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions,): string {
    const d = typeof date === 'string' ? new Date(date,) : date;
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...options,
    },).format(d,);
}

export function formatDateTime(date: Date | string,): string {
    return formatDate(date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    },);
}

export function formatRelativeTime(date: Date | string,): string {
    const d = typeof date === 'string' ? new Date(date,) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSecs = Math.floor(diffMs / 1000,);
    const diffMins = Math.floor(diffSecs / 60,);
    const diffHours = Math.floor(diffMins / 60,);
    const diffDays = Math.floor(diffHours / 24,);
    const diffWeeks = Math.floor(diffDays / 7,);
    const diffMonths = Math.floor(diffDays / 30,);
    const diffYears = Math.floor(diffDays / 365,);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 4) return `${diffWeeks}w ago`;
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${diffYears}y ago`;
}

export function formatFileSize(bytes: number,): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB',];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(unitIndex > 0 ? 1 : 0,)} ${units[unitIndex]}`;
}

export function formatPercentage(value: number, decimals = 0,): string {
    return `${(value * 100).toFixed(decimals,)}%`;
}

export function pluralize(count: number, singular: string, plural?: string,): string {
    return count === 1 ? singular : plural || `${singular}s`;
}
