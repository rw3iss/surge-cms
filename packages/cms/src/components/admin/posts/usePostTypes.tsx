import { createSignal, onMount, } from 'solid-js';
import { isPostType, listPostTypes, type PostTypeDefinition, registerPostType, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';

/**
 * Post types for admin pickers: the shared registry at once, merged with
 * `cms.posts.types()` when it loads so types registered only on the server
 * show too (they are registered locally, so `getPostType` resolves them).
 *
 * A plain signal, not a resource — reading an unresolved resource under the
 * app Suspense would blank the page while it loads.
 */
export function usePostTypes() {
    const [types, setTypes,] = createSignal<PostTypeDefinition[]>(listPostTypes(),);
    onMount(() => {
        void cms.posts.types().then((server,) => {
            let added = false;
            for (const def of server ?? []) {
                if (def?.key && !isPostType(def.key,)) {
                    try { registerPostType(def,); added = true; } catch { /* invalid key: skip */ }
                }
            }
            if (added) setTypes(listPostTypes(),);
        },).catch(() => { /* keep the built-in list */ },);
    },);
    return types;
}

/** `<path>` for a type icon (24×24, stroked). */
export function PostTypeIcon(props: { def: PostTypeDefinition; class?: string; },) {
    return (
        <svg
            class={props.class ?? 'post-type-icon'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={props.def.icon} />
        </svg>
    );
}
