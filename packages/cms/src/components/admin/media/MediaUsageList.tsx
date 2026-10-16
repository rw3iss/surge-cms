import type { MediaUsage, MediaUsageKind, } from '@sitesurge/types';
import { type Component, createMemo, For, Show, } from 'solid-js';
import './MediaUsageList.scss';

const KIND_LABEL: Record<MediaUsageKind, string> = {
    page: 'Pages',
    post: 'Posts',
    campaign: 'Campaigns',
    event: 'Events',
    product: 'Products',
    gallery_item: 'Gallery',
    mail_template: 'Mail templates',
    component: 'Components',
    block_template: 'Entity templates',
    site_settings: 'Settings',
    header: 'Site header',
    footer: 'Site footer',
    social_post: 'Social posts',
    user: 'Users',
    entity: 'Entity records',
};

/**
 * "Used in N places:" — usages grouped by kind, each a link to its editor,
 * opening in a new tab (the dialog stays open), at most `max` rows then
 * "…and N more". The server caps each media
 * at 20 usages, so the count reads "20+" when a cap may have been hit.
 */
const MediaUsageList: Component<{ usages: MediaUsage[]; max?: number; heading?: string; }> = (props,) => {
    const max = () => props.max ?? 8;
    const shown = createMemo(() => props.usages.slice(0, max(),),);
    const groups = createMemo(() => {
        const map = new Map<MediaUsageKind, MediaUsage[]>();
        for (const u of shown()) map.set(u.kind, [...(map.get(u.kind,) ?? []), u,],);
        return [...map.entries(),];
    },);
    const count = () => props.usages.length;
    return (
        <div class="media-usage">
            <p class="media-usage__heading">
                {props.heading ?? 'Used in'} {count() >= 20 ? '20+' : count()} place{count() === 1 ? '' : 's'}:
            </p>
            <For each={groups()}>
                {([kind, list,],) => (
                    <div class="media-usage__group">
                        <span class="media-usage__kind">{KIND_LABEL[kind] ?? kind}</span>
                        <ul class="media-usage__list">
                            <For each={list}>
                                {(u,) => (
                                    <li>
                                        <Show when={u.adminUrl} fallback={<span>{u.label}</span>}>
                                            <a href={u.adminUrl!} target="_blank" rel="noopener" title="Opens in a new tab">{u.label}</a>
                                        </Show>
                                        <Show when={u.field}>
                                            <span class="media-usage__field"> — {u.field}</span>
                                        </Show>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </div>
                )}
            </For>
            <Show when={count() > max()}>
                <p class="media-usage__more">…and {count() - max()} more</p>
            </Show>
        </div>
    );
};

export default MediaUsageList;
