/**
 * Pure @mention helpers for the live chat (`LiveChat.tsx`): split a message
 * into text + mention parts, tell whether it mentions the reader, find the
 * `@query` under the caret, and rank autocomplete candidates. Framework-free
 * so they are unit-testable.
 *
 * A mention is `@` + letters/digits/`_`/`-`/`.`, not preceded by a word
 * character (so an email address `a@b.com` is not a mention). A trailing `.`
 * or `-` is punctuation, not part of the name (`thanks @bob.`).
 */
import type { LiveChatMessage, } from '@sitesurge/types';

export type ChatPart = { kind: 'text'; value: string; } | { kind: 'mention'; value: string; name: string; };

export interface MentionCandidate {
    /** Dedupe key (user id when known, else the token). */
    key: string;
    name: string;
    handle: string | null;
}

export interface MentionQuery {
    /** Index of the `@`. */
    start: number;
    /** Text typed after the `@` (may be empty). */
    query: string;
}

const MENTION_RE = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_][A-Za-z0-9_.-]*)/g;

/** Lowercase, spaces removed — how a name compares with a mention. */
export function mentionKey(s: string | null | undefined,): string {
    return (s ?? '').replace(/\s+/g, '',).toLowerCase();
}

/** The text inserted for a candidate: `@handle`, else the name without spaces. */
export function mentionToken(c: Pick<MentionCandidate, 'name' | 'handle'>,): string {
    return c.handle || c.name.replace(/\s+/g, '',);
}

function trimName(raw: string,): string {
    return raw.replace(/[.-]+$/, '',);
}

/** Split chat text into plain text and mention parts (in order). */
export function parseMentions(text: string,): ChatPart[] {
    const parts: ChatPart[] = [];
    let last = 0;
    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(text,)) !== null) {
        const name = trimName(m[2],);
        if (!name) continue;
        const at = m.index + m[1].length;
        if (at > last) parts.push({ kind: 'text', value: text.slice(last, at,), },);
        parts.push({ kind: 'mention', value: `@${name}`, name, },);
        last = at + 1 + name.length;
        MENTION_RE.lastIndex = last;
    }
    if (last < text.length) parts.push({ kind: 'text', value: text.slice(last,), },);
    return parts;
}

/** Every mentioned name in the text (without `@`). */
export function mentionedNames(text: string,): string[] {
    return parseMentions(text,).flatMap((p,) => (p.kind === 'mention' ? [p.name,] : []));
}

/** True when the text mentions the reader by handle or by name (spaces removed). */
export function mentionsMe(text: string, me: { name?: string | null; handle?: string | null; } | null | undefined,): boolean {
    if (!me) return false;
    const mine = new Set([mentionKey(me.handle,), mentionKey(me.name,),].filter(Boolean,),);
    if (!mine.size) return false;
    return mentionedNames(text,).some((n,) => mine.has(mentionKey(n,),));
}

/** The `@query` the caret is in, or null. */
export function mentionQueryAt(text: string, caret: number,): MentionQuery | null {
    const before = text.slice(0, caret,);
    const m = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_.-]*)$/.exec(before,);
    if (!m) return null;
    return { start: caret - m[2].length - 1, query: m[2], };
}

/** Distinct authors of the messages (most recent first), plus extra candidates. */
export function collectCandidates(
    messages: readonly LiveChatMessage[],
    extra: readonly MentionCandidate[] = [],
    selfUserId?: string | null,
): MentionCandidate[] {
    const seen = new Set<string>();
    const out: MentionCandidate[] = [];
    const add = (c: MentionCandidate,) => {
        const token = mentionKey(mentionToken(c,),);
        if (!token || seen.has(c.key,) || seen.has(`t:${token}`,)) return;
        seen.add(c.key,);
        seen.add(`t:${token}`,);
        out.push(c,);
    };
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (selfUserId && m.userId === selfUserId) continue;
        add({ key: m.userId ? `u:${m.userId}` : `n:${mentionKey(m.name,)}`, name: m.name, handle: m.handle ?? null, },);
    }
    for (const c of extra) add(c,);
    return out;
}

/**
 * Candidates matching the query, best first: handle prefix, then name prefix,
 * then a word in the name starting with the query. An empty query lists all.
 */
export function matchCandidates(candidates: readonly MentionCandidate[], query: string, limit = 6,): MentionCandidate[] {
    const q = mentionKey(query,);
    if (!q) return candidates.slice(0, limit,);
    const scored: { c: MentionCandidate; score: number; i: number; }[] = [];
    candidates.forEach((c, i,) => {
        let score = -1;
        if (mentionKey(c.handle,).startsWith(q,)) score = 0;
        else if (mentionKey(c.name,).startsWith(q,)) score = 1;
        else if (c.name.toLowerCase().split(/\s+/,).some((w,) => w.startsWith(q,))) score = 2;
        if (score >= 0) scored.push({ c, score, i, },);
    },);
    scored.sort((a, b,) => a.score - b.score || a.i - b.i);
    return scored.slice(0, limit,).map((s,) => s.c);
}

/** Replace the `@query` at `q` with the chosen token; returns the new text + caret. */
export function insertMention(text: string, q: MentionQuery, token: string,): { text: string; caret: number; } {
    const end = q.start + 1 + q.query.length;
    const after = text.slice(end,);
    const insert = `@${token}${after.startsWith(' ',) ? '' : ' '}`;
    const next = text.slice(0, q.start,) + insert + after;
    return { text: next, caret: q.start + insert.length, };
}
