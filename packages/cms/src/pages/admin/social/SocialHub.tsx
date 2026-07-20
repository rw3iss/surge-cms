import { Title, } from '@solidjs/meta';
import { A, useLocation, } from '@solidjs/router';
import { For, type ParentComponent, } from 'solid-js';

/**
 * Social hub shell — a header + sub-navigation over the three Social areas,
 * rendered as discrete routes (Posts / Compose / Configuration). The active
 * route's component is rendered via `props.children` (nested router outlet).
 */
const SUB_NAV = [
    { path: '/admin/social', label: 'Posts', end: true, },
    { path: '/admin/social/compose', label: 'Compose', end: false, },
    { path: '/admin/social/configuration', label: 'Configuration', end: false, },
];

const SocialHub: ParentComponent = (props,) => {
    const location = useLocation();

    const isActive = (path: string, end: boolean,): boolean =>
        end ? location.pathname === path : location.pathname.startsWith(path,);

    return (
        <div class="social-hub">
            <Title>Social - Admin - RW</Title>
            <div class="admin-header">
                <h1>Social</h1>
            </div>

            <nav class="social-hub__tabs">
                <For each={SUB_NAV}>
                    {(item,) => (
                        <A
                            href={item.path}
                            end={item.end}
                            class={`social-hub__tab ${isActive(item.path, item.end,) ? 'is-active' : ''}`}
                        >
                            {item.label}
                        </A>
                    )}
                </For>
            </nav>

            <div class="social-hub__body">
                {props.children}
            </div>
        </div>
    );
};

export default SocialHub;
