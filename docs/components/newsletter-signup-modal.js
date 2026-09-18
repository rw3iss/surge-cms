/**
 * Newsletter signup modal — client module.
 *
 * WHAT IT DOES: nothing is rendered in the page. On load this decides whether
 * the visitor should be asked to join a mailing list, and if so portals a
 * dialog into <body> after a short delay.
 *
 * WHO GETS ASKED — three independent suppressions, cheapest first:
 *
 *   1. Signed up already (this browser)  -> localStorage, permanent.
 *   2. Dismissed recently (this browser) -> localStorage, expires after
 *                                           `dismissDays`.
 *   3. Subscribed already (the account)  -> one server call, signed-in only.
 *
 * The order matters. (1) and (2) are synchronous reads, so a returning visitor
 * costs no request at all; (3) is the only one that can tell us about a
 * subscription made on another device, and it is only answerable for someone
 * signed in. A successful (3) is written back into (1), so it is asked once per
 * browser rather than once per page view.
 *
 * An anonymous visitor has no server-side identity, so localStorage is the only
 * signal available for them — which is exactly why signing up writes there
 * immediately rather than relying on a later lookup.
 *
 * SDK CALLS: cms.mailingLists.subscriptionStatus(slug)  GET  /lists/:slug/subscription
 *            cms.mailingLists.subscribe(slug, { email, name })
 *                                                       POST /lists/:slug/subscribe
 * CONTEXT USED: ctx.cms, ctx.user (null when signed out), ctx.block (settings).
 *
 * Closing (×, "No thanks", Escape, or the backdrop) all do the same thing: a
 * dismissal. There is deliberately no way to close it that leaves it able to
 * reappear on the next page view, because that is indistinguishable from a bug
 * to the person being asked twice.
 */

/** Read a setting: the using block wins, then the markup attribute, then the fallback. */
function conf(root, block, key, attr, fallback) {
    const fromBlock = block && block[key];
    if (fromBlock !== undefined && fromBlock !== null && fromBlock !== '') return String(fromBlock);
    const fromAttr = root ? root.getAttribute(attr) : null;
    if (fromAttr !== null && fromAttr !== '') return fromAttr;
    return fallback;
}

/** Number from config, falling back when it is absent or nonsense. */
function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function mount(el, ctx) {
    const cms = ctx && ctx.cms;
    const user = (ctx && ctx.user) || null;
    const block = (ctx && ctx.block) || {};
    const root = el.querySelector('.nl-signup');

    const slug = conf(root, block, 'listSlug', 'data-list', 'newsletter');
    const delayMs = num(conf(root, block, 'popupDelay', 'data-delay', '2000'), 2000);
    const dismissDays = num(conf(root, block, 'dismissDays', 'data-dismiss-days', '7'), 7);
    const title = conf(root, block, 'modalTitle', 'data-title', 'Stay in the Loop');
    const lede = conf(root, block, 'modalLede', 'data-lede',
        'Get our headlines straight to your inbox. No spam, unsubscribe any time.');
    const submitLabel = conf(root, block, 'submitLabel', 'data-submit-label', 'Sign me up');
    const dismissLabel = conf(root, block, 'dismissLabel', 'data-dismiss-label', 'No thanks');

    const STORE_KEY = 'sitesurge.newsletterModal.' + slug;
    // One modal per page, whatever happens. A component dropped on the page
    // twice, or a client-side navigation that mounts the next page's copy
    // before the previous teardown runs, would otherwise stack dialogs.
    const LOCK = '__sitesurgeNewsletterModalOpen';

    let timer = null;
    let overlay = null;
    let disposed = false;
    let lastFocused = null;
    let prevBodyOverflow = '';

    // ── Local memory ────────────────────────────────────────────────────
    // Wrapped because localStorage throws outright in a few real
    // configurations (Safari private mode historically, and any browser with
    // site data blocked). A visitor with storage disabled should see the modal
    // every visit — annoying but working — rather than a script that died
    // before it rendered anything.
    const readState = () => {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
        } catch { return {}; }
    };
    const writeState = (patch) => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ ...readState(), ...patch }));
        } catch { /* storage unavailable — suppression is best-effort */ }
    };

    const suppressedLocally = () => {
        const s = readState();
        if (s.signedUp) return true;
        if (!s.dismissedAt) return false;
        // 0 means "ask again next page view", so a dismissal never expires
        // into silence the operator did not configure.
        if (dismissDays <= 0) return false;
        const age = Date.now() - Number(s.dismissedAt || 0);
        return age >= 0 && age < dismissDays * 86400000;
    };

    // ── Should we ask at all? ───────────────────────────────────────────
    const shouldAsk = async () => {
        // Never in the admin. The component renders inside the page editor's
        // block preview exactly as it does on the site, so without this the
        // operator gets a modal thrown over the editor every time they open
        // the page holding it — including while editing this component.
        if (typeof location !== 'undefined' && String(location.pathname || '').startsWith('/admin')) return false;
        if (typeof window !== 'undefined' && window[LOCK]) return false;
        if (suppressedLocally()) return false;

        // Only a signed-in visitor has an address the server can check. This is
        // what catches someone who subscribed on their phone and then arrived
        // on their laptop.
        if (user && cms && cms.mailingLists && cms.mailingLists.subscriptionStatus) {
            try {
                const res = await cms.mailingLists.subscriptionStatus(slug);
                if (res && res.subscribed) {
                    // Remember it, so this is one request per browser rather
                    // than one per page view.
                    writeState({ signedUp: true, via: 'account' });
                    return false;
                }
            } catch {
                // A failed check must not mean a silent modal forever. Falling
                // through shows it; the worst case is asking someone who is
                // already subscribed, and the server is idempotent about that.
            }
        }
        return true;
    };

    // ── The dialog ──────────────────────────────────────────────────────
    const close = (reason) => {
        if (!overlay) return;
        if (reason === 'dismiss') writeState({ dismissedAt: Date.now() });

        overlay.remove();
        overlay = null;
        if (typeof window !== 'undefined') window[LOCK] = false;
        document.removeEventListener('keydown', onKeydown, true);
        document.body.style.overflow = prevBodyOverflow;
        // Put the caret back where the visitor left it. Skipped if the page
        // moved on in the meantime (the element may no longer be in the DOM).
        if (lastFocused && document.contains(lastFocused)) {
            try { lastFocused.focus(); } catch { /* not focusable any more */ }
        }
        lastFocused = null;
    };

    function onKeydown(e) {
        if (!overlay) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            close('dismiss');
            return;
        }
        if (e.key !== 'Tab') return;
        // Keep Tab inside the dialog. Without this, tabbing walks off into the
        // page behind the backdrop — which is unreachable by mouse, so the
        // focus ring simply vanishes for several presses.
        const focusables = overlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    const open = () => {
        if (disposed || overlay) return;
        lastFocused = document.activeElement;
        if (typeof window !== 'undefined') window[LOCK] = true;

        overlay = document.createElement('div');
        overlay.className = 'nl-signup-overlay';
        overlay.innerHTML = `
          <div class="nl-signup-modal" role="dialog" aria-modal="true" aria-labelledby="nl-signup-title">
            <button type="button" class="nl-signup-modal__close" aria-label="Close">&times;</button>
            <h2 class="nl-signup-modal__title" id="nl-signup-title">${esc(title)}</h2>
            <p class="nl-signup-modal__lede">${esc(lede)}</p>
            <form novalidate>
              <label class="nl-signup-modal__field">Email address <em>(required)</em>
                <input type="email" name="email" required autocomplete="email"
                       placeholder="you@example.com" value="${esc((user && user.email) || '')}" />
              </label>
              <label class="nl-signup-modal__field">Name <em>(optional)</em>
                <input type="text" name="name" autocomplete="name"
                       value="${esc((user && user.displayName) || '')}" />
              </label>
              <p class="nl-signup-modal__msg" role="status" hidden></p>
              <div class="nl-signup-modal__actions">
                <button type="submit" class="nl-signup-modal__submit">${esc(submitLabel)}</button>
                <button type="button" class="nl-signup-modal__dismiss">${esc(dismissLabel)}</button>
              </div>
            </form>
          </div>`;

        const modal = overlay.querySelector('.nl-signup-modal');
        const form = overlay.querySelector('form');
        const msg = overlay.querySelector('.nl-signup-modal__msg');
        const submit = overlay.querySelector('.nl-signup-modal__submit');
        const emailInput = form.elements.email;

        const say = (text, ok) => {
            msg.textContent = text;
            msg.hidden = false;
            msg.classList.toggle('nl-signup-modal__msg--error', !ok);
        };

        // Backdrop click closes; a click INSIDE must not. Checking the target
        // is the overlay itself is what distinguishes them.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close('dismiss'); });
        overlay.querySelector('.nl-signup-modal__close')
            .addEventListener('click', () => close('dismiss'));
        overlay.querySelector('.nl-signup-modal__dismiss')
            .addEventListener('click', () => close('dismiss'));

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = String(new FormData(form).get('email') || '').trim();
            const name = String(new FormData(form).get('name') || '').trim();

            // `novalidate` on the form so this message is ours and appears in
            // the same place as every other one, instead of a native bubble
            // that is styled by the browser and gone on the next click.
            if (!form.checkValidity() || !email) {
                modal.classList.add('nl-signup-modal--invalid');
                say('Please enter a valid email address.', false);
                emailInput.focus();
                return;
            }

            submit.disabled = true;
            submit.textContent = 'Signing you up…';
            try {
                const res = await cms.mailingLists.subscribe(slug, { email, name: name || undefined });

                // Written before anything else: from here on this browser must
                // not be asked again, whatever happens next.
                writeState({ signedUp: true, via: 'modal' });

                // A double-opt-in list has not finished the job yet — telling
                // someone they are subscribed when a confirmation email is
                // still unclicked is how a list quietly stops growing.
                const pending = res && res.status === 'pending_confirmation';
                say(
                    pending
                        ? 'Almost there — check your inbox and click the confirmation link.'
                        : "You're on the list. Thanks for signing up!",
                    true,
                );
                submit.textContent = 'Done';
                // Long enough to be read, short enough not to trap anyone. The
                // reason is 'signup', so it does not overwrite the permanent
                // flag with a dismissal timestamp.
                setTimeout(() => close('signup'), pending ? 4200 : 2200);
            } catch {
                say("We couldn't sign you up just then. Please try again.", false);
                submit.disabled = false;
                submit.textContent = submitLabel;
            }
        });

        prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeydown, true);
        document.body.appendChild(overlay);

        // Focus the first thing they need, not the × — which is what a browser
        // picks by default and reads as "we would like you to leave".
        try { emailInput.focus({ preventScroll: true }); } catch { /* older browsers */ }
    };

    void (async () => {
        if (!(await shouldAsk()) || disposed) return;
        timer = setTimeout(open, delayMs);
    })();

    return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
        // 'teardown', not 'dismiss': navigating away is not a refusal, and
        // recording it as one would silence the prompt for a week for someone
        // who never actually saw it.
        close('teardown');
    };
}
