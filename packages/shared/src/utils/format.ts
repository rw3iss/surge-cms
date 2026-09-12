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

/**
 * Admin-standard short date ("Aug 12, 2026"), or an em-dash for a null/empty
 * value. This is the single formatter behind the ~13 per-page `formatDate`
 * copies that all did `toLocaleDateString({month:'short',day,year})` with a
 * null → '—' guard.
 */
export function formatDateShort(date: Date | string | null | undefined,): string {
    if (!date) return '—';
    return formatDate(date, { month: 'short', day: 'numeric', year: 'numeric', },);
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

/**
 * Seconds → clock notation: `0:42`, `12:07`, `1:02:04`.
 *
 * Minutes are padded only when an hours part precedes them, matching how
 * every video player writes a runtime — `2:05`, not `02:05`.
 *
 * Returns null rather than a string for anything that is not a real positive
 * length (null/undefined, NaN, 0, negative). Callers render nothing in that
 * case: a missing duration is normal (most providers report none), and a
 * placeholder like "0:00" would state a length that is not true.
 */
export function formatDuration(seconds: number | null | undefined,): string | null {
    if (seconds === null || seconds === undefined) return null;
    const total = Math.round(Number(seconds,),);
    if (!Number.isFinite(total,) || total <= 0) return null;

    const h = Math.floor(total / 3600,);
    const m = Math.floor((total % 3600) / 60,);
    const s = total % 60;
    const ss = String(s,).padStart(2, '0',);
    return h > 0 ? `${h}:${String(m,).padStart(2, '0',)}:${ss}` : `${m}:${ss}`;
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
