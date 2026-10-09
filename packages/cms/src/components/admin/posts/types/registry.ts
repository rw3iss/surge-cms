/**
 * Post-type EDITOR registry — auto-discovers `./<editorKey>/index.tsx`.
 *
 * Each folder default-exports a `Component<PostTypeEditorProps>`. Resolution
 * for a definition (`getEditorFor`):
 *   1. a folder named after the TYPE key (`types/announcement/`),
 *   2. else a folder named after `def.editor` (`blocks`, `live`, …),
 *   3. else the `custom` type's editor (the blocks editor).
 * See README.md in this folder.
 */
import type { Component, } from 'solid-js';
import { CUSTOM_POST_TYPE, getPostType, type PostTypeDefinition, } from '@sitesurge/types';
import type { PostTypeEditorProps, } from './types';

export type PostTypeEditor = Component<PostTypeEditorProps>;

const modules = import.meta.glob<{ default?: PostTypeEditor; }>('./*/index.tsx', { eager: true, },);

const editors = new Map<string, PostTypeEditor>();
for (const [path, mod,] of Object.entries(modules,)) {
    const key = /^\.\/([^/]+)\/index\.tsx$/.exec(path,)?.[1];
    if (key && typeof mod.default === 'function') editors.set(key, mod.default,);
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
