/**
 * Short relative time for discussion UIs: "just now", "5m ago", "3h ago",
 * "2d ago", then the date. Shared by comments (CommentItem) and the Forum
 * block, so a post reads the same everywhere. Pure — `now` is injectable for
 * tests.
 */
export function timeAgo(iso: string | null | undefined, now: number = Date.now(),): string {
    if (!iso) return '';
    const d = new Date(iso,);
    const t = d.getTime();
    if (!Number.isFinite(t,)) return '';
    const s = Math.max(0, (now - t) / 1000,);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60,)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600,)}h ago`;
    if (s < 7 * 86_400) return `${Math.floor(s / 86_400,)}d ago`;
    return d.toLocaleDateString();
}
