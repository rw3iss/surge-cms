/**
 * "As Seen On" ticker — client module.
 *
 * Everything that needs a measurement lives here; the layout, colours and the
 * animation itself are CSS. This decides only three things:
 *
 *   1. scroll or sit still,
 *   2. how many copies of the item set the track needs to loop seamlessly,
 *   3. how long one loop takes, so both rows move at the same pixels/second.
 *
 * Config comes from data-* attributes on the root (documented in the HTML
 * block). The block that USES this component can also override any of them via
 * its own settings, which arrive as ctx.block — handy for putting the same
 * ticker on two pages at different speeds.
 */

/** Read a config value: the using block's setting wins, then the markup. */
function conf(root, block, key, attr, fallback) {
    const fromBlock = block && block[key];
    if (fromBlock !== undefined && fromBlock !== null && fromBlock !== '') return String(fromBlock);
    const fromAttr = root.getAttribute(attr);
    if (fromAttr !== null && fromAttr !== '') return fromAttr;
    return fallback;
}

const isTrue = (v) => v === true || v === 'true' || v === '1' || v === 'yes';

export function mount(el, ctx) {
    const root = el.querySelector('.asot');
    if (!root) return () => {};

    const block = (ctx && ctx.block) || {};
    // px per second. 0 (or a nonsense value) means "don't animate".
    const speed = Math.max(0, Number(conf(root, block, 'tickerSpeed', 'data-speed', '55')) || 0);
    const gapRaw = conf(root, block, 'tickerGap', 'data-gap', '48px');
    const showLabels = isTrue(conf(root, block, 'tickerShowLabels', 'data-show-labels', 'true'));
    /**
     * static | auto | always.
     *
     * `data-scroll-if-fits` is still honoured so an existing instance keeps
     * working: it only ever expressed "always vs auto", which is two of the
     * three states — there was no way to say "never animate but keep my speed".
     */
    const legacyAlways = isTrue(conf(root, block, 'tickerScrollIfFits', 'data-scroll-if-fits', 'false'));
    const scrollMode = (() => {
        const raw = conf(root, block, 'tickerScroll', 'data-scroll', '').trim().toLowerCase();
        if (raw === 'static' || raw === 'auto' || raw === 'always') return raw;
        return legacyAlways ? 'always' : 'auto';
    })();
    const pauseOnHover = isTrue(conf(root, block, 'tickerPauseOnHover', 'data-pause-on-hover', 'true'));
    const fullBleed = isTrue(conf(root, block, 'tickerFullBleed', 'data-full-bleed', 'true'));
    /**
     * Minimum width of one half of a split row.
     *
     * Published as a CSS variable rather than acted on here: the wrap itself is
     * pure flexbox, so the browser re-decides it on every resize for free. The
     * script would only be able to re-check it when it happens to re-measure,
     * which is strictly worse.
     */
    const splitMin = conf(root, block, 'tickerSplitMin', 'data-split-min', '250px').trim();

    // A bare number is a pixel count; anything else is a CSS length the author
    // wrote deliberately (rem, %, clamp(), …) and is passed through.
    const gapCss = /^-?\d*\.?\d+$/.test(String(gapRaw).trim())
        ? `${Number(gapRaw)}px`
        : String(gapRaw);
    const gapIsZero = parseFloat(gapCss) === 0;
    // Any CSS justify-content. Gap 0 still means "spread across the width",
    // which is just a different default rather than a separate mode.
    const justify = conf(root, block, 'tickerJustify', 'data-justify', '').trim()
        || (gapIsZero ? 'space-evenly' : 'center');

    root.style.setProperty('--asot-gap', gapCss);
    if (splitMin) {
        // A bare number is a pixel count, matching how data-gap is read.
        root.style.setProperty(
            '--asot-split-min',
            /^-?\d*\.?\d+$/.test(splitMin) ? `${Number(splitMin)}px` : splitMin,
        );
    }
    root.classList.toggle('asot--no-labels', !showLabels);
    root.classList.toggle('asot--spread', gapIsZero);
    root.style.setProperty('--asot-justify', justify);

    const rows = Array.from(root.querySelectorAll('.asot__row'));
    // Keep the pristine item set. Every re-layout rebuilds from this, so
    // repeated resizes can't compound duplicates.
    const originals = rows.map((row) => {
        const track = row.querySelector('.asot__track');
        return { row, track, html: track ? track.innerHTML : '' };
    });

    /**
     * Match the fades to whatever background the block actually ended up with.
     * A background set in the style panel is not knowable from here, so it is
     * read back off the element — otherwise a themed ticker shows two grey
     * smudges where the gradients assumed the default.
     */
    function syncBackdrop() {
        const bg = getComputedStyle(root).backgroundColor;
        // A transparent root means the section behind it shows through; fading
        // to a colour would be worse than not fading at all.
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            root.style.setProperty('--asot-bg', bg);
        } else {
            root.style.removeProperty('--asot-bg');
        }
    }

    /**
     * Span the window, escaping the page's content column.
     *
     * Measured rather than done in CSS with `100vw`: `100vw` INCLUDES the
     * scrollbar, so it overshoots by ~15px on a desktop with a classic
     * scrollbar. `documentElement.clientWidth` is the usable width, and the
     * offset is taken from the PARENT's box — the element's own left edge moves
     * as soon as the margin is applied, so measuring itself would chase its own
     * tail on every resize.
     *
     * Safe here because the site sets `overflow-x: clip` on html and body; a
     * sub-pixel overshoot is clipped rather than producing a sideways scroll.
     */
    function syncBleed() {
        if (!fullBleed) return;
        root.style.width = '';
        root.style.marginLeft = '';
        root.style.marginRight = '';
        const parent = root.parentElement;
        if (!parent) return;

        // What "full width" means depends on where this is rendered. On the
        // site it is the window. In the block editor the window includes the
        // sidebar and the properties panel, so bleeding to it would push the
        // ticker straight through the editor's chrome — there, the block's own
        // preview area is the right edge to reach.
        const host = root.closest('.content-block__preview-body') || root.closest('.content-block');
        const hostRect = host ? host.getBoundingClientRect() : null;
        const targetW = hostRect ? hostRect.width : document.documentElement.clientWidth;
        const targetLeft = hostRect ? hostRect.left : 0;

        const parentRect = parent.getBoundingClientRect();
        root.style.width = `${targetW}px`;
        root.style.marginLeft = `${targetLeft - parentRect.left}px`;
        // Stops the (now wider) element from stretching the parent's own
        // layout box in the other direction.
        root.style.marginRight = `${-(targetW - (parentRect.right - targetLeft))}px`;
    }

    /** Widest label, so both rows start at the same x. */
    function syncLabelWidth() {
        if (!showLabels) {
            root.style.setProperty('--asot-label-w', '0px');
            return;
        }
        const labels = originals
            .map(({ row }) => row.querySelector('.asot__label'))
            .filter(Boolean);

        // Measure each label's NATURAL width. The CSS stretches every label to
        // the widest one (so none leaves a transparent gap before the fade),
        // which means measuring the stretched box would feed the previous
        // result straight back in — the strip could then only ever grow, and a
        // shorter label set or a smaller font would never shrink it.
        for (const label of labels) label.style.width = 'auto';
        let widest = 0;
        for (const label of labels) {
            widest = Math.max(widest, label.getBoundingClientRect().width,);
        }
        for (const label of labels) label.style.width = '';

        root.style.setProperty('--asot-label-w', `${Math.ceil(widest)}px`);
    }

    function layout() {
        // FIRST, before anything is measured. `asot--ready` switches off the
        // no-JS fallback rule, which wraps the track and pins it to 100% width.
        // Measuring while that applied made `scrollWidth` equal the container,
        // so the content never looked like it overflowed and the ticker settled
        // into the static layout instead of scrolling. Whether it recovered
        // depended on a second pass arriving from `document.fonts.ready` — a
        // race, which is why it scrolled on one page and sat still on another.
        root.classList.add('asot--ready');
        lastLayoutWidth = measuredWidth();

        syncBleed();
        syncBackdrop();
        syncLabelWidth();

        // Reset to one clean copy before measuring, or we'd measure the last
        // pass's duplicates.
        root.classList.remove('asot--scroll', 'asot--static');
        for (const o of originals) {
            if (o.track) o.track.innerHTML = o.html;
        }

        const labelW = parseFloat(getComputedStyle(root).getPropertyValue('--asot-label-w')) || 0;
        // Measured per row, then decided for the whole ticker: two rows moving
        // under one heading, one of them frozen, reads as broken.
        let anyOverflows = false;
        const measured = originals.map((o) => {
            const avail = Math.max(0, o.row.clientWidth - labelW);
            const natural = o.track ? o.track.scrollWidth : 0;
            if (natural > avail + 1) anyOverflows = true;
            return { ...o, avail, natural };
        });

        // `always` scrolls even when everything fits — the repeat step below
        // pads a short list out so the loop stays continuous rather than
        // leaving a gap while it wraps.
        const shouldScroll = speed > 0
            && scrollMode !== 'static'
            && (scrollMode === 'always' || anyOverflows);
        if (!shouldScroll) {
            root.classList.add('asot--static');
            return;
        }

        // Reduced motion: one copy, no duplication, no duration. The CSS makes
        // the row swipeable instead, so every item is still reachable — a
        // frozen duplicated track would just hide half the list behind the
        // right edge and make the user swipe past a repeat to reach it.
        const reduced = typeof matchMedia === 'function'
            && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            root.classList.add('asot--scroll');
            return;
        }

        // Build each track as exactly TWO halves. Each half repeats the item
        // set enough times to cover the viewport, so a short list still scrolls
        // continuously instead of leaving a gap while it wraps.
        let slowestHalf = 0;
        for (const m of measured) {
            if (!m.track || m.natural === 0) continue;
            const repeats = Math.max(1, Math.ceil(m.avail / m.natural));
            const half = m.html.repeat(repeats);
            m.track.innerHTML = half + half;
            // Mark the clone for the no-JS fallback rule and for screen
            // readers: the second half is the same content again.
            const half2 = m.track.scrollWidth / 2;
            slowestHalf = Math.max(slowestHalf, half2);
            m.halfWidth = half2;
        }

        // One duration per row, each derived from its own width at the SAME
        // px/sec — a shared duration would make the longer row visibly faster.
        for (const m of measured) {
            if (!m.track || !m.halfWidth) continue;
            m.track.style.setProperty('--asot-duration', `${(m.halfWidth / speed).toFixed(2)}s`);
        }

        root.classList.add('asot--scroll');
        // The duplicated half is decoration; announcing it twice is noise.
        for (const m of measured) {
            if (!m.track) continue;
            const kids = Array.from(m.track.children);
            const halfCount = kids.length / 2;
            kids.forEach((kid, i) => {
                if (i >= halfCount) kid.setAttribute('aria-hidden', 'true');
            });
        }
        void slowestHalf;
    }

    // Hover pause is a class rather than :hover in CSS so the config can turn
    // it off without shipping two stylesheets.
    const onEnter = () => root.classList.add('asot--paused');
    const onLeave = () => root.classList.remove('asot--paused');
    if (pauseOnHover) {
        root.addEventListener('mouseenter', onEnter);
        root.addEventListener('mouseleave', onLeave);
        // Keyboard users get the same escape hatch.
        root.addEventListener('focusin', onEnter);
        root.addEventListener('focusout', onLeave);
    }

    /**
     * The width a layout is FOR — the same box `syncBleed` sizes against.
     *
     * Every relayout is gated on this changing, which is the whole mobile fix:
     * hiding or showing the browser's address/nav bar changes the viewport
     * HEIGHT and fires `resize`, and relaying out restarts the CSS animation —
     * so the ticker snapped back to the start every time the bar moved. A
     * rotation changes the WIDTH, so it still relayouts.
     *
     * Deliberately not a "is this mobile?" check: the same rule stops a desktop
     * user dragging only the window's height from restarting the ticker, and
     * there is no user-agent guess to get wrong.
     */
    const measuredWidth = () => {
        const host = root.closest('.content-block__preview-body') || root.closest('.content-block');
        return Math.round(host ? host.getBoundingClientRect().width : document.documentElement.clientWidth,);
    };
    let lastLayoutWidth = -1;
    let raf = 0;
    /**
     * Throttled relayout, ~100ms.
     *
     * A drag-resize fires continuously, and `layout()` rebuilds both tracks and
     * re-measures — running it per event made the ticker stutter and, while the
     * measurements were mid-flight, left the labels and track at sizes computed
     * for a width that no longer existed. Leading edge so the first movement
     * responds immediately; trailing edge so the FINAL size is always the one
     * laid out, which is what makes it settle correctly instead of keeping a
     * stale width.
     */
    const THROTTLE_MS = 100;
    let lastRun = 0;
    let trailing = 0;
    const runLayout = () => {
        lastRun = Date.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(layout);
    };
    /** `force` is for changes that alter measurements without altering the
     *  width — a web font finally loading, an orientation flip a browser
     *  reports late. */
    const schedule = (force,) => {
        if (!force && measuredWidth() === lastLayoutWidth) return;
        const since = Date.now() - lastRun;
        window.clearTimeout(trailing);
        if (since >= THROTTLE_MS) runLayout();
        else trailing = window.setTimeout(runLayout, THROTTLE_MS - since,);
    };
    // The PARENT is what's observed, not the root: in full-bleed mode the
    // root's width is one we set ourselves, so it wouldn't change on a window
    // resize and the observer would never fire.
    const observed = root.parentElement || root;
    const onResize = () => schedule();
    /**
     * A rotation ALWAYS relayouts, even though the width test would normally
     * catch it: several browsers still report the pre-rotation dimensions
     * during the event itself, so the immediate call can read an unchanged
     * width and skip. The delayed second pass reads the settled size.
     */
    const onOrientation = () => {
        schedule(true,);
        window.setTimeout(() => schedule(true,), 250,);
    };
    const ro = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onResize,)
        : null;
    if (ro) ro.observe(observed,);
    // Belt and braces for the case where the parent's width is also fixed
    // (a full-width page shell doesn't change when the window does).
    window.addEventListener('resize', onResize,);
    window.addEventListener('orientationchange', onOrientation,);

    layout();
    // Custom faces load asynchronously; every width measured before Oswald
    // arrives is the fallback font's.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => schedule(true,),).catch(() => {});
    }

    return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(trailing);
        if (ro) ro.disconnect();
        window.removeEventListener('resize', onResize,);
        window.removeEventListener('orientationchange', onOrientation,);
        root.style.width = '';
        root.style.marginLeft = '';
        root.style.marginRight = '';
        root.removeEventListener('mouseenter', onEnter);
        root.removeEventListener('mouseleave', onLeave);
        root.removeEventListener('focusin', onEnter);
        root.removeEventListener('focusout', onLeave);
        for (const o of originals) {
            if (o.track) o.track.innerHTML = o.html;
        }
        root.classList.remove('asot--scroll', 'asot--static', 'asot--ready', 'asot--paused');
    };
}
