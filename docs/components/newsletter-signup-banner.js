/**
 * Newsletter signup banner — client module (component "Newsletter Signup Banner").
 *
 * A slim bar (email · optional name · Sign up · ×) meant for the top of a page.
 * It stays hidden unless this visitor should be asked:
 *
 *   1. Signed up already (this browser)  → never shown again.
 *   2. Dismissed with ×                  → hidden for `dismissDays` (0 = for good).
 *   3. Subscribed already (the account)  → one server call, signed-in only.
 *
 * (1) and (2) live in the SDK's browser-local UI settings (`ctx.cms.ui`, key
 * `newsletterBanner.<slug>`), falling back to localStorage directly on an
 * older SDK. A signup here also sets the Newsletter Signup MODAL's flag (and a
 * modal signup is honoured here), so a visitor is never asked twice.
 *
 * Placement: the bar FLOATS over the top of the page content (the first hero)
 * just below the site header, taking no space in the flow — the wrapper is
 * zero-height and the bar is absolutely positioned at the header's bottom
 * edge + a small gap. It works for every header mode: a header in the page
 * flow (static/sticky) leaves just the gap; a floating header (absolute or
 * fixed, over the page) pushes the bar down by the header's height.
 *
 * Re-measured whenever that can change: the header's size, its class/style
 * (a page applies its own header position — e.g. "float" — AFTER the site
 * header first renders, which moves this block up to the top of the page),
 * window resize, and a few ticks after mount for late layout.
 *
 * After a signup the fields turn into a success message for `doneMs` (3 s),
 * then the bar fades out. × fades it out the same way.
 *
 * SDK: cms.mailingLists.subscriptionStatus(slug), cms.mailingLists.subscribe(slug, { email, name }),
 *      cms.ui.get / cms.ui.merge.
 * CONTEXT: ctx.cms, ctx.user (null when signed out), ctx.block (settings override data-* attributes).
 */

function conf(root, block, key, attr, fallback) {
    const fromBlock = block && block[key];
    if (fromBlock !== undefined && fromBlock !== null && fromBlock !== '') return String(fromBlock);
    const fromAttr = root ? root.getAttribute(attr) : null;
    if (fromAttr !== null && fromAttr !== '') return fromAttr;
    return fallback;
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function mount(el, ctx) {
    const cms = ctx && ctx.cms;
    const user = (ctx && ctx.user) || null;
    const block = (ctx && ctx.block) || {};
    const root = el.querySelector('.nl-banner');
    if (!root) return undefined;

    const slug = conf(root, block, 'listSlug', 'data-list', 'newsletter');
    const dismissDays = num(conf(root, block, 'dismissDays', 'data-dismiss-days', '0'), 0);
    const doneMs = num(conf(root, block, 'doneMs', 'data-done-ms', '3000'), 3000);

    const UI_KEY = 'newsletterBanner.' + slug;
    // The modal's own record — shared so one signup silences both.
    const MODAL_KEY = 'sitesurge.newsletterModal.' + slug;
    const FALLBACK_KEY = 'sitesurge.uiSettings.fallback.' + UI_KEY;

    let disposed = false;
    let timer = null;

    // ── Browser-local state (SDK ui settings, else raw localStorage) ────────
    const hasUi = Boolean(cms && cms.ui && typeof cms.ui.get === 'function');
    const readState = () => {
        if (hasUi) return cms.ui.get(UI_KEY, {}) || {};
        try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}') || {}; } catch { return {}; }
    };
    const writeState = (patch) => {
        if (hasUi) { cms.ui.merge(UI_KEY, patch); return; }
        try { localStorage.setItem(FALLBACK_KEY, JSON.stringify({ ...readState(), ...patch })); } catch { /* best effort */ }
    };
    const modalSignedUp = () => {
        try { return Boolean((JSON.parse(localStorage.getItem(MODAL_KEY) || '{}') || {}).signedUp); } catch { return false; }
    };
    const markModalSignedUp = () => {
        try {
            const cur = JSON.parse(localStorage.getItem(MODAL_KEY) || '{}') || {};
            localStorage.setItem(MODAL_KEY, JSON.stringify({ ...cur, signedUp: true, via: 'banner' }));
        } catch { /* best effort */ }
    };

    const suppressedLocally = () => {
        const s = readState();
        if (s.signedUp || modalSignedUp()) return true;
        if (!s.dismissedAt) return false;
        if (dismissDays <= 0) return true; // dismissed for good
        const age = Date.now() - Number(s.dismissedAt || 0);
        return age >= 0 && age < dismissDays * 86400000;
    };

    // In the admin (page editor preview / component editor) just show it — no
    // checks, no storage writes, no submits.
    const inAdmin = typeof location !== 'undefined' && String(location.pathname || '').startsWith('/admin');

    const form = root.querySelector('.nl-banner__form');
    const msg = root.querySelector('.nl-banner__msg');
    const submit = root.querySelector('.nl-banner__submit');
    const closeBtn = root.querySelector('.nl-banner__close');
    const emailInput = form && form.elements.email;
    const nameInput = form && form.elements.name;

    const GAP = 12;
    const findHeader = () => document.querySelector('.layout header.header') || document.querySelector('header.header');
    /** The site header's bottom edge, in document coordinates. */
    const headerBottom = () => {
        const header = findHeader();
        if (!header) return 0;
        const h = header.offsetHeight;
        // A fixed header sits at the viewport top; otherwise use its place in
        // the page (offsetTop ignores the auto-hide transform).
        return getComputedStyle(header).position === 'fixed' ? h : header.offsetTop + h;
    };
    /** Put the bar just below the header, over whatever follows. */
    const place = () => {
        const wrapTop = el.getBoundingClientRect().top + window.scrollY;
        root.style.top = Math.max(0, headerBottom() - wrapTop) + GAP + 'px';
    };
    const onResize = () => { if (root.classList.contains('is-shown')) place(); };
    let headerObserver = null;
    let headerMutations = null;
    const ticks = [];

    const show = () => {
        if (disposed) return;
        // The wrapper takes no space: the bar floats over the next block.
        el.style.position = 'relative';
        el.style.height = '0';
        el.style.zIndex = '20';
        root.classList.add('is-shown');
        place();
        window.addEventListener('resize', onResize);
        window.addEventListener('load', onResize);
        const header = findHeader();
        if (header && typeof ResizeObserver === 'function') {
            headerObserver = new ResizeObserver(onResize);
            headerObserver.observe(header);
        }
        // Float / sticky / auto-hide are class and style changes on the header.
        if (header && typeof MutationObserver === 'function') {
            headerMutations = new MutationObserver(onResize);
            headerMutations.observe(header, { attributes: true, attributeFilter: ['class', 'style',], },);
        }
        // Late layout (fonts, the page's own header settings, images above).
        for (const ms of [50, 250, 800, 2000,]) ticks.push(setTimeout(onResize, ms,),);
    };

    const unwatch = () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('load', onResize);
        if (headerObserver) { headerObserver.disconnect(); headerObserver = null; }
        if (headerMutations) { headerMutations.disconnect(); headerMutations = null; }
        ticks.splice(0,).forEach(clearTimeout);
    };

    /** Fade out and lift, then hide. */
    const collapse = () => {
        if (!root.classList.contains('is-shown')) return;
        root.classList.add('is-leaving');
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(() => {
            root.classList.remove('is-shown', 'is-leaving');
            unwatch();
        }, reduce ? 0 : 320);
    };

    const say = (text, ok) => {
        msg.textContent = text;
        msg.hidden = false;
        msg.classList.toggle('nl-banner__msg--error', !ok);
    };

    if (inAdmin) {
        root.classList.add('nl-banner--static', 'is-shown');
        return undefined;
    }

    // Prefill for a signed-in member.
    if (user) {
        if (emailInput && user.email) emailInput.value = user.email;
        if (nameInput && user.displayName) nameInput.value = user.displayName;
    }

    const onClose = () => {
        writeState({ dismissedAt: Date.now() });
        collapse();
    };
    closeBtn && closeBtn.addEventListener('click', onClose);

    const onSubmit = async (e) => {
        e.preventDefault();
        const email = String((emailInput && emailInput.value) || '').trim();
        const name = String((nameInput && nameInput.value) || '').trim();
        if (!form.checkValidity() || !email) {
            root.classList.add('nl-banner--invalid');
            say('Please enter a valid email address.', false);
            emailInput && emailInput.focus();
            return;
        }
        submit.disabled = true;
        submit.textContent = 'Signing up…';
        try {
            const res = await cms.mailingLists.subscribe(slug, { email, name: name || undefined });
            writeState({ signedUp: true, via: 'banner' });
            markModalSignedUp();
            const pending = res && res.status === 'pending_confirmation';
            root.classList.remove('nl-banner--invalid');
            root.classList.add('nl-banner--done');
            say(pending
                ? 'Almost there — check your inbox and click the confirmation link.'
                : "You're on the list. Thanks for signing up!", true);
            timer = setTimeout(collapse, doneMs);
        } catch {
            say("We couldn't sign you up just then. Please try again.", false);
            submit.disabled = false;
            submit.textContent = 'Sign up';
        }
    };
    form && form.addEventListener('submit', onSubmit);

    // ── Should we ask at all? ───────────────────────────────────────────────
    void (async () => {
        if (suppressedLocally()) return;
        if (user && cms && cms.mailingLists && cms.mailingLists.subscriptionStatus) {
            try {
                const res = await cms.mailingLists.subscriptionStatus(slug);
                if (res && res.subscribed) {
                    writeState({ signedUp: true, via: 'account' });
                    return;
                }
            } catch { /* a failed check shows the banner; subscribing again is idempotent */ }
        }
        show();
    })();

    return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
        unwatch();
        closeBtn && closeBtn.removeEventListener('click', onClose);
        form && form.removeEventListener('submit', onSubmit);
    };
}
