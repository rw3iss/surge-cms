/**
 * Player icons: 24px grid, 1.5px round strokes, `currentColor`.
 *
 * Each icon is a COMPONENT, so every use renders its own <svg>. A shared
 * module-level JSX constant would be one DOM node, and a node can only sit in
 * one place — the second use would silently steal it from the first.
 */
import type { JSX, ParentComponent, } from 'solid-js';

const Svg: ParentComponent<{ class?: string; }> = (p,) => (
    <svg
        class={`vp-icon${p.class ? ` ${p.class}` : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        {p.children}
    </svg>
);

type Icon = () => JSX.Element;

export const IconPlay: Icon = () => (
    <Svg>
        <path d="M7.5 5.2v13.6a1 1 0 0 0 1.52.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8a1 1 0 0 0-1.52.86z" fill="currentColor" />
    </Svg>
);

export const IconPause: Icon = () => (
    <Svg>
        <rect x="6.25" y="4.75" width="3.75" height="14.5" rx="1.1" fill="currentColor" />
        <rect x="14" y="4.75" width="3.75" height="14.5" rx="1.1" fill="currentColor" />
    </Svg>
);

const Speaker = () => <path d="M11 5.5 6.6 9H4.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.1l4.4 3.5z" />;

export const IconVolumeMuted: Icon = () => (
    <Svg>
        <Speaker />
        <path d="m15.5 9.5 5 5m0-5-5 5" />
    </Svg>
);

export const IconVolumeLow: Icon = () => (
    <Svg>
        <Speaker />
        <path d="M14.75 9.25a3.9 3.9 0 0 1 0 5.5" />
    </Svg>
);

export const IconVolumeHigh: Icon = () => (
    <Svg>
        <Speaker />
        <path d="M14.75 9.25a3.9 3.9 0 0 1 0 5.5" />
        <path d="M17.6 6.4a7.9 7.9 0 0 1 0 11.2" />
    </Svg>
);

export const IconSettings: Icon = () => (
    <Svg>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </Svg>
);

export const IconPip: Icon = () => (
    <Svg>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <rect x="12.5" y="12" width="5.5" height="4.25" rx="0.8" fill="currentColor" stroke="none" />
    </Svg>
);

export const IconFullscreen: Icon = () => (
    <Svg>
        <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </Svg>
);

export const IconFullscreenExit: Icon = () => (
    <Svg>
        <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
    </Svg>
);

export const IconCheck: Icon = () => (
    <Svg>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
);

export const IconChevronLeft: Icon = () => (
    <Svg>
        <path d="m14.5 6-6 6 6 6" />
    </Svg>
);

export const IconChevronRight: Icon = () => (
    <Svg>
        <path d="m9.5 6 6 6-6 6" />
    </Svg>
);

export const IconRewind: Icon = () => (
    <Svg>
        <path d="m11 6-6 6 6 6M18 6l-6 6 6 6" />
    </Svg>
);

export const IconForward: Icon = () => (
    <Svg>
        <path d="m6 6 6 6-6 6M13 6l6 6-6 6" />
    </Svg>
);

export const IconAlert: Icon = () => (
    <Svg>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.4v.1" />
    </Svg>
);
