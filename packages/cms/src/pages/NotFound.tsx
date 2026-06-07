import { A, } from '@solidjs/router';
import { Component, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { siteLogo, siteName, } from '../stores/siteSettings';
import './NotFound.scss';

const NotFoundPage: Component = () => (
    <div class="not-found">
        <SeoHead title="Page Not Found" description="The page you're looking for doesn't exist." noindex={true} nofollow={true} />
        <A href="/" class="not-found__logo-link">
            <Show
                when={siteLogo()}
                fallback={<span class="not-found__site-name">{siteName()}</span>}
            >
                <img src={siteLogo()} alt={siteName()} class="not-found__logo" />
            </Show>
        </A>
        <h1 class="not-found__code">404</h1>
        <p class="not-found__message">Page Not Found</p>
        <p class="not-found__detail">The page you're looking for doesn't exist or has been moved.</p>
        <A href="/" class="not-found__btn">Go Home</A>
    </div>
);

export default NotFoundPage;
