/**
 * Wrap every build-time stylesheet in `@layer theme`.
 *
 * WHY: block styles are emitted at runtime into the `block` / `block-bp` layers
 * (see utils/blockResponsiveCss.ts). Layer order — declared once in index.html
 * as `@layer theme, tpl, block, block-bp` — beats selector specificity outright,
 * so a `[data-block-id="…"]` rule wins against a theme rule of any complexity
 * without `!important` and without selector arithmetic.
 *
 * That only holds while the theme is actually IN a layer. Unlayered CSS outranks
 * every layer, so one stray unwrapped stylesheet silently beats all block
 * styling — with no visible clue as to why. `cascadeLayers.test.ts` guards it.
 *
 * Done here rather than in the 107 SCSS files because each is imported directly
 * by its own component; there is no single import chain to wrap.
 */

/** At-rules that must stay at the top level — CSS forbids them inside @layer. */
const HOISTED_AT_RULES = new Set(['charset', 'import', 'namespace']);

const wrapInThemeLayer = () => {
    return {
        postcssPlugin: 'wrap-in-theme-layer',
        Once(root, { AtRule }) {
            // Idempotent: a stylesheet that already declares its own layer is
            // left alone, so a file can opt out deliberately.
            let alreadyLayered = false;
            root.walkAtRules('layer', () => { alreadyLayered = true; });
            if (alreadyLayered) return;

            const hoisted = [];
            const wrapped = [];
            for (const node of root.nodes ?? []) {
                if (node.type === 'atrule' && HOISTED_AT_RULES.has(node.name.toLowerCase())) {
                    hoisted.push(node);
                } else {
                    wrapped.push(node);
                }
            }
            // Nothing but @import/@charset, or an empty file — no layer needed.
            if (wrapped.length === 0) return;

            const layer = new AtRule({ name: 'layer', params: 'theme' });
            layer.append(wrapped);
            root.removeAll();
            root.append(...hoisted, layer);
        },
    };
};
wrapInThemeLayer.postcss = true;

export default { plugins: [wrapInThemeLayer()] };
