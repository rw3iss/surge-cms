/**
 * Extra `{{ }}` variables for admin block previews.
 *
 * Some variables are bound by the SERVER at render time and have no client-side
 * source: an email's `{{list.*}}` and `{{template.*}}` are attached by the send
 * worker, and `{{user.*}}` there means the RECIPIENT rather than the signed-in
 * admin. The cms template runtime knows nothing about any of them, so a block
 * preview rendered a blank where the sent email will have a value.
 *
 * The editor that owns such variables publishes a SAMPLE bag here, and
 * `TemplatedContent` merges it into every preview it renders. Reading it there
 * — rather than threading a prop through BlockPreview → BlockRenderer → each
 * block type — is what makes it reach every surface at once: the deselected
 * block preview, the Custom HTML editor's Preview tab, rich text, and blocks
 * nested inside groups and templates.
 *
 * A single global signal, because one editor is open at a time. Every OTHER
 * editor leaves it empty, so page/post previews are unaffected. The publisher
 * clears it on unmount.
 */
import { createSignal, } from 'solid-js';

const [previewVariables, setPreviewVariables,] = createSignal<Record<string, unknown> | undefined>(undefined,);

export { previewVariables, setPreviewVariables, };

/**
 * Expand a flat `{'list.name': 'x'}` catalog into the nested bag the template
 * runtime resolves against. Mirrors the server's `buildSampleContext`, so the
 * admin preview and the mail preview agree on shape.
 */
export function expandVariablePaths(flat: Record<string, unknown>,): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [path, value,] of Object.entries(flat,)) {
        const parts = path.split('.',);
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
            cur = cur[key] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]] = value;
    }
    return out;
}
