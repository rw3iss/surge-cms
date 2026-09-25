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

/**
 * Build the preview bag for a mail template from the variable catalog.
 *
 * `site.*` is deliberately EXCLUDED. The catalog's site entries are
 * placeholders ("SiteSurge", "https://example.com/logo.png"), and this bag
 * merges LAST in the runtime — so publishing them replaced the real site bag
 * built from live settings, and `{{site.logo}}` previewed as a 404ing
 * example.com URL instead of the actual logo.
 *
 * The server preview settled the same question the same way: real site values
 * beat catalog samples, so a preview cannot show a different logo from the one
 * that ships. The client holds those real values too, so it has no reason to
 * fall back to a sample.
 *
 * `overrides` are values the editor genuinely knows (the template's own name,
 * subject, preheader) and win over the samples.
 */
export function buildMailPreviewVariables(
    catalog: ReadonlyArray<{ path: string; sample: unknown; }>,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    // Applied to overrides too, not just the catalog: the exclusion is this
    // function's guarantee, and a guarantee with a back door is not one.
    const isSite = (path: string,): boolean => path === 'site' || path.startsWith('site.',);

    const flat: Record<string, unknown> = {};
    for (const v of catalog) {
        if (isSite(v.path,)) continue;
        flat[v.path] = v.sample;
    }
    for (const [k, v,] of Object.entries(overrides,)) {
        if (isSite(k,)) continue;
        if (v !== undefined && v !== '') flat[k] = v;
    }
    return expandVariablePaths(flat,);
}
