/**
 * The help page REGISTRY — the one list of /admin/help pages. The help index
 * (pages/admin/Help.tsx) and the "Help contents" dropdown on every help page
 * (components/admin/help/HelpContents.tsx) both read it, so a new help page is
 * added HERE once and appears in both. `helpTopics.test.ts` fails when a
 * /admin/help route in App.tsx has no entry.
 */
import { isFeatureEnabled, } from '../../stores/siteSettings';

/**
 * `dev` = a developer reference (right column); otherwise a general guide.
 * `feature` = the guide documents that feature: it is marked "(feature off)"
 * and listed last while the feature is disabled.
 */
export interface HelpTopic { path: string; title: string; desc: string; dev?: boolean; feature?: string; }

/** Admin documentation index. New help topics get added here as the CMS grows. */
export const TOPICS: HelpTopic[] = [
    {
        path: '/admin/help/sdk',
        dev: true,
        title: 'Headless usage & SDK',
        desc: 'Talk to this CMS from your own app — connecting, auth modes, and what the typed client returns.',
    },
    {
        path: '/admin/help/sdk/reference',
        dev: true,
        title: 'SDK Reference',
        desc: 'Every cms.* module and method of @sitesurge/client — signatures, parameters, return types — generated from the client source.',
    },
    {
        path: '/admin/help/api',
        dev: true,
        title: 'API Reference',
        desc: 'Every REST route under /api/v1 — method, path, auth tier, input fields and the SDK method that calls it — generated from the route manifest.',
    },
    {
        path: '/admin/help/sdk/modules',
        dev: true,
        title: 'Creating a feature module',
        desc: 'Add an installable feature at the code level: registry entry, migrations, repo/service/routes, DTOs.',
    },
    {
        path: '/admin/help/sdk/permissions',
        dev: true,
        title: 'Permissions in a module',
        desc: 'Declare and check granular permissions from backend code, and how precedence resolves.',
    },
    {
        path: '/admin/help/sdk/component-js',
        dev: true,
        title: 'Component JavaScript',
        desc: 'Give a Component a client script: the mount(el, ctx) contract, what the CMS SDK exposes to it, slots & props reference, and why inline JS is blocked.',
    },
    {
        path: '/admin/help/releases',
        title: 'Releases & updates',
        desc: 'How a new CMS version is published (pnpm release) and how an installation updates to it (Check for update → Update & restart).',
    },
    {
        path: '/admin/help/post-types',
        feature: 'posts',
        title: 'Post types',
        desc: 'Article, Video, Short, Live Show and Custom posts — and how to create your own post type: register it, add a custom editor form, a gated sample and a public display.',
    },
    {
        path: '/admin/help/live-shows',
        feature: 'posts',
        title: 'Live shows',
        desc: 'Stream a show from the browser: provider setup, running the show, recordings and replays, and moderating viewers (mute, silence, kick, ban).',
    },
    {
        path: '/admin/help/comments-and-forum',
        feature: 'discussions',
        title: 'Comments & Forum',
        desc: 'Comments on posts and events, the members\' forum, moderation, member pages + activity counts, and showing latest / hottest discussions anywhere.',
    },
    {
        path: '/admin/help/components',
        title: 'Components',
        desc: 'Reusable templates of one or more blocks: build once, place anywhere with the Component block, and feed them data with slots and options with props.',
    },
    {
        path: '/admin/help/gallery',
        feature: 'gallery',
        title: 'Gallery',
        desc: 'Publish media to a public gallery: drafts + Publish, item visibility and comments, settings and appearance, the Gallery block, {{gallery()}} and the SDK.',
    },
    {
        path: '/admin/help/video',
        feature: 'video',
        title: 'Video hosting',
        desc: 'Upload large videos, how encoding works, public vs private videos and teasers, using a video in a block, and server setup.',
    },
    {
        path: '/admin/help/variables-and-functions',
        dev: true,
        title: 'Variables & Functions',
        desc: 'The {{ … }} template syntax for content blocks — variables, entity lookups, if/for logic, and every function + entity schema.',
    },
];

/** Developer references, in reading order (guide → references → specifics). */
export const DEV_ORDER = [
    '/admin/help/sdk',
    '/admin/help/sdk/modules',
    '/admin/help/sdk/permissions',
    '/admin/help/sdk/component-js',
    '/admin/help/variables-and-functions',
    '/admin/help/sdk/reference',
    '/admin/help/api',
];

/** `discussions` is the hidden base of Comments + Forum: on when either is. */
export const topicFeatureOn = (t: HelpTopic,): boolean => {
    if (!t.feature) return true;
    if (t.feature === 'discussions') return isFeatureEnabled('comments',) || isFeatureEnabled('forum',);
    return isFeatureEnabled(t.feature,);
};

export const matches = (t: HelpTopic, q: string,): boolean =>
    !q || `${t.title} ${t.desc}`.toLowerCase().includes(q,);

/** Enabled topics first (in their own order), then the ones for features that are off. */
export const byFeature = (list: HelpTopic[],): HelpTopic[] => [...list.filter(topicFeatureOn,), ...list.filter((t,) => !topicFeatureOn(t,)),];

export const SECTIONS = TOPICS.filter((t,) => !t.dev,);
export const DEV_REFERENCES = TOPICS.filter((t,) => t.dev,)
    .sort((a, b,) => DEV_ORDER.indexOf(a.path,) - DEV_ORDER.indexOf(b.path,));


/** Both groups for a contents list: general topics (enabled features first) + developer references. */
export function helpGroups(): { topics: HelpTopic[]; references: HelpTopic[]; } {
    return { topics: byFeature(SECTIONS,), references: DEV_REFERENCES, };
}
