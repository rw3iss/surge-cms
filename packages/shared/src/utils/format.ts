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
 * Format a date against a token PATTERN (`YYYY-MM-DD`, `MMM D, YYYY`, `HH:mm`).
 *
 * Exists because `formatDate` renders one fixed shape, and a template author
 * writing `{{ formatDate('YYYY') }}` wants a year, not "Sep 24, 2026". Intl
 * cannot express an arbitrary token string, so the tokens are substituted
 * directly — but the month and weekday NAMES still come from Intl, so
 * `MMM` here and the default `formatDate` agree on "Sep" rather than drifting
 * apart through a hand-written array.
 *
 * Tokens (longest match wins, so `MMMM` is not read as `MMM` + `M`):
 *
 * | Token  | Example   |   | Token | Example |
 * |--------|-----------|---|-------|---------|
 * | `YYYY` | 2026      |   | `HH`  | 09      |
 * | `YY`   | 26        |   | `H`   | 9       |
 * | `MMMM` | September |   | `hh`  | 09      |
 * | `MMM`  | Sep       |   | `h`   | 9       |
 * | `MM`   | 09        |   | `mm`  | 05      |
 * | `M`    | 9         |   | `ss`  | 07      |
 * | `DD`   | 24        |   | `A`   | AM      |
 * | `D`    | 24        |   | `a`   | am      |
 * | `dddd` | Wednesday |   |       |         |
 * | `ddd`  | Wed       |   |       |         |
 *
 * Text between tokens is preserved. Anything in square brackets is emitted
 * literally (`[on] MMM D` → "on Sep 24"), which is the escape hatch for a word
 * that would otherwise be eaten — "Day" would become "24ay" without it.
 */
export function formatDatePattern(date: Date | string, pattern: string,): string {
    const d = typeof date === 'string' ? new Date(date,) : date;
    if (Number.isNaN(d.getTime(),)) return '';

    const pad = (n: number,): string => String(n,).padStart(2, '0',);
    const name = (opts: Intl.DateTimeFormatOptions,): string =>
        new Intl.DateTimeFormat('en-US', opts,).format(d,);

    const h24 = d.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

    const TOKENS: Record<string, () => string> = {
        YYYY: () => String(d.getFullYear(),),
        YY: () => pad(d.getFullYear() % 100,),
        MMMM: () => name({ month: 'long', },),
        MMM: () => name({ month: 'short', },),
        MM: () => pad(d.getMonth() + 1,),
        M: () => String(d.getMonth() + 1,),
        DD: () => pad(d.getDate(),),
        D: () => String(d.getDate(),),
        dddd: () => name({ weekday: 'long', },),
        ddd: () => name({ weekday: 'short', },),
        HH: () => pad(h24,),
        H: () => String(h24,),
        hh: () => pad(h12,),
        h: () => String(h12,),
        mm: () => pad(d.getMinutes(),),
        ss: () => pad(d.getSeconds(),),
        A: () => (h24 < 12 ? 'AM' : 'PM'),
        a: () => (h24 < 12 ? 'am' : 'pm'),
    };

    // ONE pass, longest token first. A sequence of per-token replaces would
    // rewrite text it had already produced — `YYYY` → "2026" is safe, but
    // `MMMM` → "September" contains "Sep", and a later `S`-ish token would
    // chew through its own output.
    const pattern_re = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g;
    return pattern.replace(pattern_re, (match, literal?: string,) => {
        if (literal !== undefined) return literal;
        return TOKENS[match]?.() ?? match;
    },);
}

/**
 * Does this string look like a date FORMAT rather than a date?
 *
 * Used to tell `formatDate('YYYY')` from `formatDate('2026-09-24')`. The
 * primary signal is that the string does not parse as a date — every real
 * pattern (`YYYY`, `MMM D, YYYY`, `HH:mm`) is an invalid Date, and every date
 * string is a valid one, so the two sets do not overlap.
 *
 * The token check is a second, POSITIVE signal, so that a string which is
 * merely nonsense ("hello") is not silently treated as a format producing
 * today's date. It has to look like a pattern, not just fail to be a date.
 */
export function looksLikeDateFormat(value: string,): boolean {
    const v = value.trim();
    if (!v) return false;
    if (!Number.isNaN(new Date(v,).getTime(),)) return false;
    return /YYYY|YY|MMMM|MMM|MM|dddd|ddd|DD|HH|hh|mm|ss/.test(v,);
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
