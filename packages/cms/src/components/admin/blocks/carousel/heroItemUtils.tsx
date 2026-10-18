/**
 * Carousel editor helpers — split out of HeroContentEditor.tsx (was 1,189
 * lines): id generation, item summaries, option defaults, and the shared
 * commit-on-blur text input.
 */
import type { HeroCarouselOptions, HeroItem, HeroTextConfig, } from '@sitesurge/types';
import { cssLength, } from '@sitesurge/types';
import { CommitInput, } from '../../forms/CommitInput';

export const genId = () => 'hero-' + Date.now() + '-' + Math.random().toString(36,).slice(2, 7,);

/** One-line summary of a Posts item's query, for its card preview. */
export function postsSummary(item: HeroItem,): string {
    const cfg = item.posts ?? {};
    const parts: string[] = [];
    const pinned = cfg.pinnedPostIds?.length ?? 0;
    if (pinned > 0) parts.push(`${pinned} specific`,);
    if (cfg.queryEnabled !== false) parts.push(`query · ${cfg.count ?? 5}`,);
    return parts.length ? parts.join(' + ',) : 'No posts configured';
}

/** One-line summary of an Entity item's binding, for its card preview. */
export function entitySummary(item: HeroItem,): string {
    const cfg = item.entity;
    if (!cfg?.entityType) return 'Not configured';
    const type = cfg.entityType;
    const b = cfg.binding;
    if (!cfg.templateId) return `${type} · pick a template`;
    switch (b?.mode) {
        case 'single':
            return b.ref ? `${type}: ${b.ref}` : `${type} · pick one`;
        case 'list':
            return `${type} · ${(b.refs ?? []).length} selected`;
        case 'query':
            return `${type} · query`;
        case 'context':
            return `${type} · current page`;
        default:
            return type;
    }
}

/** Any CSS length the rest of the editor accepts (rem, clamp(), calc(), svh…);
 *  a value that could escape a style declaration is refused. */
export const isValidHeight = (v: string,) => Boolean(cssLength(v,),) && !/[;{}<>]/.test(v,);

export const OBJECT_FIT_OPTIONS: HeroItem['objectFit'][] = ['cover', 'contain', 'fill', 'none', 'scale-down',];
export const HEADING_SIZES: HeroTextConfig['size'][] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6',];

export const DEFAULT_OPTIONS: HeroCarouselOptions = {
    autoScroll: false,
    autoScrollInterval: 3000,
    repeat: true,
    customHeight: false,
    height: '50vh',
};

/** Local-state text input — syncs to parent on blur or Enter (Shift+Enter = newline). */
export function TextInput(props: { value: string; placeholder?: string; rows?: number; onUpdate: (val: string,) => void; },) {
    return (
        <CommitInput
            multiline
            commitOnEnter
            trim={false}
            rows={props.rows || 2}
            class="input input--sm"
            placeholder={props.placeholder}
            value={props.value}
            onCommit={props.onUpdate}
        />
    );
}
