/**
 * Per-quality encode status chips for a video: `480p ✓`, `1080p 43%`,
 * `720p queued`, `360p failed`. Full-video renditions only, highest first
 * (the teaser is shown as its own chip on the tile).
 */
import type { VideoRendition, } from '@sitesurge/types';
import { Component, For, } from 'solid-js';
import './VideoMedia.scss';

type ChipRendition = Pick<VideoRendition, 'variant' | 'name' | 'status' | 'progress'>;

const heightOf = (name: string,) => Number.parseInt(name, 10,) || 0;

function chipText(r: ChipRendition,): string {
    switch (r.status) {
        case 'ready': return `${r.name} ✓`;
        case 'encoding':
        case 'uploading': return `${r.name} ${Math.floor(r.progress,)}%`;
        default: return `${r.name} ${r.status}`;
    }
}

export const RenditionChips: Component<{ renditions: ChipRendition[]; class?: string; }> = (p,) => {
    const list = () =>
        p.renditions
            .filter((r,) => r.variant === 'full')
            .slice()
            .sort((a, b,) => heightOf(b.name,) - heightOf(a.name,));
    return (
        <div class={`rendition-chips ${p.class ?? ''}`}>
            <For each={list()}>
                {(r,) => <span class={`rendition-chip rendition-chip--${r.status}`}>{chipText(r,)}</span>}
            </For>
        </div>
    );
};

export default RenditionChips;
