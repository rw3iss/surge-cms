import { Component, Show, } from 'solid-js';
import './SiteLogo.scss';

export interface SiteLogoProps {
    name?: string;
    logoSrc?: string; // custom logo image (overrides SVG icon + text)
    size?: 'small' | 'default' | 'large';
    layout?: 'row' | 'column';
    class?: string;
}

const SiteLogo: Component<SiteLogoProps> = (props,) => {
    const size = () => props.size || 'default';
    const layout = () => props.layout || 'row';
    const name = () => props.name || 'Surge Media';

    return (
        <div class={`site-logo site-logo--${size()} site-logo--${layout()} ${props.class || ''}`}>
            <Show
                when={props.logoSrc}
                fallback={
                    <>
                        <img src="/images/surge_logo.svg" alt="" class="site-logo__icon" />
                        <span class="site-logo__text">{name()}</span>
                    </>
                }
            >
                <img src={props.logoSrc} alt={name()} class="site-logo__custom-img" />
            </Show>
        </div>
    );
};

export default SiteLogo;
