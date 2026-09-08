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
    const scrollIfFits = isTrue(conf(root, block, 'tickerScrollIfFits', 'data-scroll-if-fits', 'false'));
    const pauseOnHover = isTrue(conf(root, block, 'tickerPauseOnHover', 'data-pause-on-hover', 'true'));
    const fullBleed = isTrue(conf(root, block, 'tickerFullBleed', 'data-full-bleed', 'true'));

    // A bare number is a pixel count; anything else is a CSS length the author
    // wrote deliberately (rem, %, clamp(), …) and is passed through.
    const gapCss = /^-?\d*\.?\d+$/.test(String(gapRaw).trim())
        ? `${Number(gapRaw)}px`
        : String(gapRaw);
    const gapIsZero = parseFloat(gapCss) === 0;

    root.style.setProperty('--asot-gap', gapCss);
    root.classList.toggle('asot--no-labels', !showLabels);
    root.classList.toggle('asot--spread', gapIsZero);

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

        const shouldScroll = speed > 0 && (scrollIfFits || anyOverflows);
        if (!shouldScroll) {
            root.classList.add('asot--static');
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

    // Re-measure on width changes: rotating a phone flips the fits/doesn't-fit
    // decision, and a font swapping in changes every measurement.
    let lastWidth = 0;
    let raf = 0;
    const schedule = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(layout);
    };
    // The PARENT is what's observed, not the root: in full-bleed mode the
    // root's width is one we set ourselves, so it wouldn't change on a window
    // resize and the observer would never fire.
    const observed = root.parentElement || root;
    const ro = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const w = Math.round(entries[0].contentRect.width);
            if (w === lastWidth) return; // height-only changes are our own doing
            lastWidth = w;
            schedule();
        })
        : null;
    if (ro) ro.observe(observed);
    // Belt and braces for the case where the parent's width is also fixed
    // (a full-width page shell doesn't change when the window does on some
    // mobile browsers' URL-bar transitions).
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);

    layout();
    // Custom faces load asynchronously; every width measured before Oswald
    // arrives is the fallback font's.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(schedule).catch(() => {});
    }

    return () => {
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        window.removeEventListener('resize', schedule);
        window.removeEventListener('orientationchange', schedule);
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
