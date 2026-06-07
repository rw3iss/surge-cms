import type { ContentAccessLevel, } from '@rw/cms-shared';
import { Component, Show, } from 'solid-js';

interface ContentGateProps {
    accessLevel: ContentAccessLevel;
    preview: {
        title?: string;
        description?: string;
        featuredImage?: string;
    };
}

const ContentGate: Component<ContentGateProps> = (props,) => {
    const returnUrl = () => encodeURIComponent(window.location.pathname,);

    const ctaText = () =>
        props.accessLevel === 'patron' ?
            'Sign in with Patreon to access' :
            'Sign in to access';

    const ctaDescription = () =>
        props.accessLevel === 'patron' ?
            'This content is available exclusively to Patreon supporters.' :
            'This content is available to registered members.';

    return (
        <div class="content-gate">
            <div class="content-gate__preview">
                <Show when={props.preview.featuredImage}>
                    <div class="content-gate__image-wrapper">
                        <img
                            src={props.preview.featuredImage}
                            alt={props.preview.title || ''}
                            class="content-gate__image"
                        />
                        <div class="content-gate__image-overlay" />
                    </div>
                </Show>
                <div class="content-gate__info">
                    <Show when={props.preview.title}>
                        <h1 class="content-gate__title">{props.preview.title}</h1>
                    </Show>
                    <Show when={props.preview.description}>
                        <p class="content-gate__description">{props.preview.description}</p>
                    </Show>
                </div>
            </div>
            <div class="content-gate__lock">
                <div class="content-gate__lock-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <p class="content-gate__message">{ctaDescription()}</p>
                <a
                    href={`/login?return=${returnUrl()}`}
                    class="content-gate__cta btn btn--primary"
                >
                    {ctaText()}
                </a>
                <Show when={props.accessLevel === 'patron'}>
                    <p class="content-gate__patron-hint">
                        Already a patron? <a href={`/login?return=${returnUrl()}`}>Sign in</a> to unlock this content.
                    </p>
                </Show>
            </div>
        </div>
    );
};

export default ContentGate;
