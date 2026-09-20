/**
 * Where to draw a popover panel relative to its trigger.
 *
 * Extracted from `AddBlockMenu` as a pure function of the geometry so the flip
 * rule can be tested — it is the kind of logic that is only ever verified by
 * someone noticing a menu off the bottom of the screen.
 */

export interface TriggerRect {
    /** Viewport-relative, as `getBoundingClientRect` reports them. */
    top: number;
    bottom: number;
    left: number;
}

export interface MenuGeometry {
    viewportHeight: number;
    viewportWidth: number;
    /** Gap between the trigger and the panel. */
    offset: number;
    /** Panel minimum width, used to keep it on screen horizontally. */
    minWidth: number;
    /** Ceiling on the panel height, as a percentage of the viewport height. */
    maxHeightVh: number;
    /** Below this much room underneath the trigger, flip above it. */
    minUsable: number;
}

export interface MenuPlacement {
    placement: 'below' | 'above';
    /** Used when `placement` is 'below'. */
    top: number;
    /** Used when `placement` is 'above' — distance from the viewport bottom. */
    bottom: number;
    left: number;
    maxHeight: number;
}

/** Keep-on-screen margin. */
const EDGE = 12;
/** Never squeeze the panel below this, even in a cramped viewport. */
const MIN_HEIGHT = 160;
/**
 * How much roomier "above" must be before a flip is worth it.
 *
 * Without a margin, a short viewport flips the menu to gain a few dozen
 * pixels — the panel jumps to the other side of the button for no practical
 * benefit, and a small scroll can flip it back. Requiring a real improvement
 * keeps placement stable and predictable.
 */
const FLIP_MARGIN = 80;

/**
 * Prefer below; flip above only when below is genuinely cramped AND above has
 * more room.
 *
 * Both conditions matter. Flipping purely on "not enough below" would send a
 * menu upward in a short viewport where above is no better; flipping purely on
 * "more room above" would flip menus that were perfectly fine. The margin on
 * the second condition stops a flip that gains only a few pixels.
 *
 * A flipped panel is anchored by its BOTTOM edge, not its top: the panel's
 * height is not known until it renders, and anchoring a flipped menu by `top`
 * draws it upward from the trigger to wherever its height lands — which is how
 * an earlier attempt put the bottom button's menu up beside the top one.
 */
export function computeMenuPlacement(
    trigger: TriggerRect,
    geo: MenuGeometry,
): MenuPlacement {
    const desiredMaxHeight = Math.floor(geo.viewportHeight * (geo.maxHeightVh / 100),);

    let left = trigger.left;
    if (left + geo.minWidth > geo.viewportWidth - EDGE) {
        left = Math.max(EDGE, geo.viewportWidth - geo.minWidth - EDGE,);
    }

    const top = trigger.bottom + geo.offset;
    const spaceBelow = geo.viewportHeight - top - EDGE;
    const spaceAbove = trigger.top - geo.offset - EDGE;

    if (spaceBelow < geo.minUsable && spaceAbove > spaceBelow + FLIP_MARGIN) {
        return {
            placement: 'above',
            top: 0,
            bottom: Math.max(EDGE, geo.viewportHeight - trigger.top + geo.offset,),
            left,
            maxHeight: Math.min(desiredMaxHeight, Math.max(MIN_HEIGHT, spaceAbove,),),
        };
    }

    return {
        placement: 'below',
        top,
        bottom: 0,
        left,
        maxHeight: Math.min(desiredMaxHeight, Math.max(MIN_HEIGHT, spaceBelow,),),
    };
}
