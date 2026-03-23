import { A, } from '@solidjs/router';
import { Component, For, Show, } from 'solid-js';
import './Footer.scss';

interface FooterProps {
    siteName: string;
    socialLinks: Record<string, string>;
    contactEmail?: string;
}

const socialIcons: Record<string, string> = {
    patreon: 'M',
    youtube: 'Y',
    instagram: 'I',
    facebook: 'F',
    twitter: 'X',
    tiktok: 'T',
};

export const Footer: Component<FooterProps> = (props,) => {
    const socialEntries = () => Object.entries(props.socialLinks,).filter(([, url,],) => url && url.trim());

    return (
        <footer class="footer">
            <div class="footer__container">
                <div class="footer__top">
                    <div class="footer__brand">
                        <h3 class="footer__title">{props.siteName}</h3>
                        <p class="footer__tagline">Independent journalism for the people</p>
                    </div>

                    <div class="footer__links">
                        <div class="footer__column">
                            <h4 class="footer__column-title">Navigate</h4>
                            <ul class="footer__list">
                                <li>
                                    <A href="/">Home</A>
                                </li>
                                <li>
                                    <A href="/about">About</A>
                                </li>
                                <li>
                                    <A href="/donate">Support Us</A>
                                </li>
                                <li>
                                    <A href="/contact">Contact</A>
                                </li>
                            </ul>
                        </div>

                        <div class="footer__column">
                            <h4 class="footer__column-title">Legal</h4>
                            <ul class="footer__list">
                                <li>
                                    <A href="/privacy">Privacy Policy</A>
                                </li>
                                <li>
                                    <A href="/terms">Terms of Service</A>
                                </li>
                            </ul>
                        </div>

                        <Show when={socialEntries().length > 0}>
                            <div class="footer__column">
                                <h4 class="footer__column-title">Follow Us</h4>
                                <div class="footer__social">
                                    <For each={socialEntries()}>
                                        {([platform, url,],) => (
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class={`footer__social-link footer__social-link--${platform}`}
                                                aria-label={`Follow us on ${platform}`}
                                            >
                                                <span class="footer__social-icon">
                                                    {socialIcons[platform] || platform[0].toUpperCase()}
                                                </span>
                                            </a>
                                        )}
                                    </For>
                                </div>
                            </div>
                        </Show>
                    </div>
                </div>

                <div class="footer__bottom">
                    <p class="footer__copyright">
                        &copy; {new Date().getFullYear()} {props.siteName}. All rights reserved.
                    </p>
                    <Show when={props.contactEmail}>
                        <a href={`mailto:${props.contactEmail}`} class="footer__email">
                            {props.contactEmail}
                        </a>
                    </Show>
                </div>
            </div>
        </footer>
    );
};
