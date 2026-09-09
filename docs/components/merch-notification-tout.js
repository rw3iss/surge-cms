/**
 * Merchandise-notification tout.
 *
 * WHAT IT DOES: renders a button that joins the new-merchandise mailing list.
 *  - Signed in  -> one click; the server uses the account address and ignores
 *                  anything posted, so no form is needed.
 *  - Signed out -> a modal asking for email (required) + optional name/phone.
 *
 * SDK CALLS: cms.shop.merchandiseSignup({ email?, name?, phone? })
 *            -> POST /api/v1/shop/merchandise-signup
 * CONTEXT USED: ctx.user (null when signed out), ctx.cms.
 *
 * The success message is identical whether the address was new or already
 * subscribed — matching the server, which deliberately will not let a stranger
 * test list membership.
 */
export function mount(el, ctx) {
    const { cms, user } = ctx;
    const SUCCESS = "You're on the list — we'll email you when new merchandise arrives.";
    let done = false;

    // Enhance the component's OWN markup rather than replacing it: `el` wraps
    // the rendered blocks, so the button lands inside the card the HTML block
    // drew. Falling back to `el` keeps the component working if that block is
    // edited away.
    const host = el.querySelector('.merch-tout') || el;
    const actions = document.createElement('div');
    actions.className = 'merch-tout__actions';
    actions.innerHTML =
        '<button type="button" class="merch-tout__btn">Get Notifications for New Merchandise</button>'
        + '<p class="merch-tout__msg" role="status" hidden></p>';
    host.appendChild(actions);
    const btn = actions.querySelector('.merch-tout__btn');
    const msg = actions.querySelector('.merch-tout__msg');

    const say = (text, ok) => {
        msg.textContent = text;
        msg.hidden = false;
        msg.classList.toggle('merch-tout__msg--error', !ok);
    };

    const subscribe = async (body) => {
        btn.disabled = true;
        btn.textContent = 'Signing you up…';
        try {
            await cms.shop.merchandiseSignup(body);
            done = true;
            say(SUCCESS, true);
            // remove(), not hidden: the flex container's display would fight
            // the [hidden] attribute and leave a ghost button on screen.
            btn.remove();
            closeModal();
        } catch {
            say("We couldn't sign you up just then. Please try again.", false);
            btn.disabled = false;
            btn.textContent = 'Get Notifications for New Merchandise';
        }
    };

    let overlay = null;
    const closeModal = () => { overlay?.remove(); overlay = null; };

    const openModal = () => {
        overlay = document.createElement('div');
        overlay.className = 'merch-tout-overlay';
        overlay.innerHTML = `
          <div class="merch-tout-modal" role="dialog" aria-modal="true" aria-label="New merchandise alerts">
            <button type="button" class="merch-tout-modal__close" aria-label="Close">×</button>
            <h2>New merchandise alerts</h2>
            <p>We'll email you when new items hit the shop. Nothing else.</p>
            <form>
              <label>Email <em>(required)</em>
                <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" />
              </label>
              <label>Name <em>(optional)</em><input type="text" name="name" autocomplete="name" /></label>
              <label>Phone <em>(optional)</em><input type="tel" name="phone" autocomplete="tel" /></label>
              <button type="submit" class="btn">Notify me</button>
            </form>
          </div>`;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        overlay.querySelector('.merch-tout-modal__close').addEventListener('click', closeModal);
        overlay.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            void subscribe({
                email: String(f.get('email') || '').trim(),
                name: String(f.get('name') || '').trim() || undefined,
                phone: String(f.get('phone') || '').trim() || undefined,
            });
        });
        document.body.appendChild(overlay);
    };

    const onClick = () => {
        if (done) return;
        // Signed in: the server uses the account address, so asking again is theatre.
        if (user) { void subscribe({}); return; }
        openModal();
    };
    btn.addEventListener('click', onClick);

    // Teardown: the modal is portalled to <body>, so it must be removed by hand.
    return () => { btn.removeEventListener('click', onClick); actions.remove(); closeModal(); };
}
