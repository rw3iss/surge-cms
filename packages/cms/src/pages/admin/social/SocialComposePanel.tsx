import { Component, } from 'solid-js';

/**
 * Compose & cross-post panel. Wired up in Milestone 4 (POSSE publish).
 * Placeholder until then so the /admin/social/compose route resolves.
 */
const SocialComposePanel: Component = () => {
    return (
        <section class="social-compose">
            <div class="empty-state">
                <p>Compose &amp; cross-post is coming soon.</p>
                <p class="form-help">
                    You'll be able to write once and publish to your connected providers. For now,
                    add existing posts by URL on the Posts tab.
                </p>
            </div>
        </section>
    );
};

export default SocialComposePanel;
