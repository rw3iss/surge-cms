/**
 * Post-type EDITOR registry — auto-discovers `./<editorKey>/index.tsx`.
 *
 * Each folder default-exports a `Component<PostTypeEditorProps>`. Resolution
 * for a definition (`getEditorFor`):
 *   1. a folder named after the TYPE key (`types/announcement/`),
 *   2. else a folder named after `def.editor` (`blocks`, `live`, …),
 *   3. else the `custom` type's editor (the blocks editor).
 * See README.md in this folder.
 *
 * Loading: the `blocks` editor (Article / Video / Short / Custom — almost
 * every post) is bundled with the PostEditor; every other editor (the Live
 * console with its WHIP publisher, recorder and chat, …) is a LAZY chunk
 * fetched only when a post of that type is opened. The PostEditor renders the
 * editor inside a Suspense boundary.
 */
import { type Component, lazy, } from 'solid-js';
import { CUSTOM_POST_TYPE, getPostType, type PostTypeDefinition, } from '@sitesurge/types';
import type { PostTypeEditorProps, } from './types';

export type PostTypeEditor = Component<PostTypeEditorProps>;

type EditorModule = { default?: PostTypeEditor; };
const eager = import.meta.glob<EditorModule>('./blocks/index.tsx', { eager: true, },);
const loaders = import.meta.glob<EditorModule>(['./*/index.tsx', '!./blocks/index.tsx',],);

const keyOf = (path: string,): string | undefined => /^\.\/([^/]+)\/index\.tsx$/.exec(path,)?.[1];
const editors = new Map<string, PostTypeEditor>();
for (const [path, mod,] of Object.entries(eager,)) {
    const key = keyOf(path,);
    if (key && typeof mod.default === 'function') editors.set(key, mod.default,);
}
for (const [path, load,] of Object.entries(loaders,)) {
    const key = keyOf(path,);
    // One lazy component per folder (a stable identity, so <Dynamic> never remounts it).
    if (key && !editors.has(key,)) {
        editors.set(key, lazy(async () => {
            const mod = await load();
            return { default: mod.default ?? (() => null), };
        },),);
    }
}

/** Editor folder keys found at build time (for diagnostics/tests). */
export function editorKeys(): string[] {
    return [...editors.keys(),].toSorted();
}

export function getEditorFor(def: PostTypeDefinition,): PostTypeEditor {
    const found = editors.get(def.key,) ?? editors.get(def.editor,);
    if (found) return found;
    const custom = getPostType(CUSTOM_POST_TYPE,);
    return editors.get(custom.key,) ?? editors.get(custom.editor,) ?? editors.get('blocks',)!;
}
