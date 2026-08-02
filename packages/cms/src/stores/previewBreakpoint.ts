import { createSignal, } from 'solid-js';

/**
 * The breakpoint currently being SIMULATED in the block editor preview (a
 * `SiteBreakpoint.id`, or '' for full size). The editor toolbar's "Preview
 * breakpoint" selector sets this; `ContentBlock` reads it and merges that
 * breakpoint's style overrides inline so the inline-edit preview shows the
 * responsive result — the device-preview container is only max-width-capped,
 * so real `@media` queries won't fire there and we simulate instead.
 *
 * Module-global (one editor is active at a time); the editor resets it to ''
 * on unmount.
 */
export const [previewBreakpoint, setPreviewBreakpoint,] = createSignal('',);
