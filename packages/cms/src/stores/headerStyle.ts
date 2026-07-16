/**
 * Active header color style for the current route.
 *
 * The Site Header carries a regular and an "alt" (dark) color pair. A page
 * or post decides which pair the header renders in. Because the Header is
 * rendered by `Layout` (a sibling of the routed page content), the page/post
 * component publishes its resolved choice here and the Header reads it — a
 * global signal keeps them in sync regardless of tree position.
 *
 * Defaults to 'default'. Each page/post sets it on load and resets it to
 * 'default' on cleanup (route change), so routes that don't touch it (home,
 * donate, …) always render the regular header colors.
 */
import { createSignal, } from 'solid-js';

export type HeaderStyleMode = 'default' | 'alt';

const [activeHeaderStyle, setActiveHeaderStyle,] = createSignal<HeaderStyleMode>('default',);

export { activeHeaderStyle, setActiveHeaderStyle, };
