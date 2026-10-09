# Post-type editors

The Post editor's **Content** section is rendered by the editor for the post's
type. Editors are discovered automatically: every `./<editorKey>/index.tsx` in
this folder (via `import.meta.glob` in `registry.ts`) default-exports a
`Component<PostTypeEditorProps>` (see `types.ts`).

| Folder | Used by |
|---|---|
| `blocks/` | `article`, `video`, `custom`, and any type with `editor: 'blocks'` |
| `live/` | `live` (live-show console: camera preview, show settings, host controls) |

## Resolution (`getEditorFor(def)`)

1. A folder named after the **type key** (`types/announcement/`).
2. Else a folder named after **`def.editor`** (`blocks`, `live`, …).
3. Else the `custom` type's editor (the blocks editor).

## Adding a post type

1. **Register it in shared code** (loaded by both the server and the SPA, so the
   server accepts the key and the admin lists it):

   ```ts
   import { registerPostType } from '@sitesurge/types';

   registerPostType({
       key: 'announcement',            // [a-z][a-z0-9_-]{1,31}
       label: 'Announcement',
       description: 'A short notice with one Rich Text block.',
       icon: 'M4 10h3l7-5v14l-7-5H4z',  // 24×24 stroked SVG path
       editor: 'blocks',               // or your own editor key
       display: 'blocks',
       defaultBlocks: [{ type: 'rich_text', data: { content: '' } }],
       settingsDefaults: {},           // seeds `typeSettings`
   });
   ```

   That alone is enough: the type shows in **New Post** and in the editor's
   **Type** select, and uses the blocks editor. Types registered only on the
   server still show (the admin merges `cms.posts.types()` in), but register in
   shared code when you can.

2. **Optional — a bespoke editor**: add `types/<key>/index.tsx` (or
   `types/<editor>/index.tsx` to share it between types):

   ```tsx
   import type { Component } from 'solid-js';
   import type { PostTypeEditorProps } from '../types';

   const AnnouncementEditor: Component<PostTypeEditorProps> = (props) => (
       <section>…uses props.blocks / props.onBlocksChange,
           props.typeSettings / props.onTypeSettingsChange…</section>
   );
   export default AnnouncementEditor;
   ```

   No registration step. Read props inside JSX/effects (don't destructure — Solid
   props are reactive). Lift every change through the callbacks: the Post editor
   owns the state, dirty tracking, autosave and save body.

## Type changes

Changing an existing post's type replaces its blocks with the new type's
`defaultBlocks` only when it has none, or only the previous type's untouched
defaults (`postTypeBlocks.ts`). User content is never deleted; switching to or
from `live` keeps the blocks.
