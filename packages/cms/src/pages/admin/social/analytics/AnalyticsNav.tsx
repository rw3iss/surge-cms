import { A, useLocation, } from '@solidjs/router';
import { For, type JSX, type ParentComponent, Show, } from 'solid-js';

/**
 * Sub-navigation of Social → Analytics (Dashboard · Digests · Settings), with an
 * optional actions slot on the right (page Save / Generate buttons). Sticky, so
 * a page's controls stay in reach while it scrolls.
 */
const LINKS = [
    { href: '/admin/social/analytics', label: 'Dashboard', exact: true, },
    { href: '/admin/social/analytics/digests', label: 'Digests', exact: false, },
    { href: '/admin/social/analytics/settings', label: 'Settings', exact: false, },
];

const AnalyticsNav: ParentComponent<{ actions?: JSX.Element; }> = (props,) => {
    const location = useLocation();
    const active = (href: string, exact: boolean,) => (exact ? location.pathname === href : location.pathname.startsWith(href,));
    return (
        <div class="analytics-nav">
            <nav class="analytics-nav__links" aria-label="Analytics">
                <For each={LINKS}>
                    {(l,) => (
                        <A href={l.href} end={l.exact} class={`analytics-nav__link${active(l.href, l.exact,) ? ' is-active' : ''}`}>
                            {l.label}
                        </A>
                    )}
                </For>
            </nav>
            <Show when={props.actions}>
                <div class="analytics-nav__actions">{props.actions}</div>
            </Show>
        </div>
    );
};

export default AnalyticsNav;
