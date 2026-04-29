import { Component, Show, } from 'solid-js';
import './SiteLogo.scss';

export interface SiteLogoProps {
    name?: string;
    /** Custom logo image URL. When undefined, only the name is rendered. */
    logoSrc?: string;
    size?: 'small' | 'default' | 'large';
    layout?: 'row' | 'column';
    class?: string;
}

/**
 * Site/brand mark used in the public Header, AdminLayout, the 404
 * page, etc. The previous version always rendered a fallback SVG
 * (the legacy "rw_logo.svg" icon shipped with the seed install) when
 * no custom logo was set, which leaked the prior site's branding into
 * fresh installs. We now:
 *
 *   - render the custom logo image when `logoSrc` is provided
 *   - otherwise render only the site name (no static fallback icon)
 *
 * If the operator never sets a logo in `Settings → Appearance`, the
 * site simply shows its name — clean and brand-neutral.
 */
const SiteLogo: Component<SiteLogoProps> = (props,) => {
    const size = () => props.size || 'default';
    const layout = () => props.layout || 'row';
    const name = () => props.name || '';

    return (
        <div class={`site-logo site-logo--${size()} site-logo--${layout()} ${props.class || ''}`}>
            <Show when={props.logoSrc}>
                <img src={props.logoSrc} alt={name() || 'Logo'} class="site-logo__custom-img" />
            </Show>
            <Show when={name()}>
                <span class="site-logo__text">{name()}</span>
            </Show>
        </div>
    );
};

export default SiteLogo;
