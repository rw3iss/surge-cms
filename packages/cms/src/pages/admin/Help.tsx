import { A, } from '@solidjs/router';
import { Component, For, } from 'solid-js';
import './Help.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';

/** `dev` = a developer reference (right column); otherwise a general guide. */
interface HelpTopic { path: string; title: string; desc: string; dev?: boolean; }

/** Admin documentation index. New help topics get added here as the CMS grows. */
const TOPICS: HelpTopic[] = [
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
        desc: 'Give a Component a client script: the mount(el, ctx) contract, what the CMS SDK exposes to it, and why inline JS is blocked.',
    },
    {
        path: '/admin/help/releases',
        title: 'Releases & updates',
        desc: 'How a new CMS version is published (pnpm release) and how an installation updates to it (Check for update → Update & restart).',
    },
    {
        path: '/admin/help/post-types',
        title: 'Post types',
        desc: 'Article, Video, Short, Live Show and Custom posts — and how to create your own post type: register it, add a custom editor form, a gated sample and a public display.',
    },
    {
        path: '/admin/help/comments-and-forum',
        title: 'Comments & Forum',
        desc: 'Comments on posts and events, the members\' forum, moderation, member pages + activity counts, and showing latest / hottest discussions anywhere.',
    },
    {
        path: '/admin/help/gallery',
        title: 'Gallery',
        desc: 'Publish media to a public gallery: drafts + Publish, item visibility and comments, settings and appearance, the Gallery block, {{gallery()}} and the SDK.',
    },
    {
        path: '/admin/help/video',
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
const DEV_ORDER = [
    '/admin/help/sdk',
    '/admin/help/sdk/modules',
    '/admin/help/sdk/permissions',
    '/admin/help/sdk/component-js',
    '/admin/help/variables-and-functions',
    '/admin/help/sdk/reference',
    '/admin/help/api',
];

const SECTIONS = TOPICS.filter((t,) => !t.dev,);
const DEV_REFERENCES = TOPICS.filter((t,) => t.dev,)
    .sort((a, b,) => DEV_ORDER.indexOf(a.path,) - DEV_ORDER.indexOf(b.path,));

const TopicList: Component<{ topics: HelpTopic[]; }> = (props,) => (
    <div class="admin-help__topics">
        <For each={props.topics}>
            {(t,) => (
                <A href={t.path} class="admin-help__card">
                    <h3 class="admin-help__card-title">{t.title}</h3>
                    <p class="admin-help__card-desc">{t.desc}</p>
                </A>
            )}
        </For>
    </div>
);

const AdminHelp: Component = () => (
    <div class="admin-help">
        <AdminTitle>Help</AdminTitle>
        <div class="admin-header">
            <h1>Help &amp; Documentation</h1>
        </div>
        <p class="form-help-muted admin-help__intro">
            Reference documentation for this Surge CMS site.
        </p>
        {/* Two columns on wide screens; below 900px one column, with the
            developer references after the general sections (DOM order). */}
        <div class="admin-help__columns">
            <section class="admin-section admin-help__group">
                <header class="admin-section__header">
                    <h2>Sections</h2>
                    <p class="form-help-muted">Guides to the site's features.</p>
                </header>
                <TopicList topics={SECTIONS} />
            </section>
            <section class="admin-section admin-help__group">
                <header class="admin-section__header">
                    <h2>Developer References</h2>
                    <p class="form-help-muted">The SDK, the REST API, modules, permissions and templating.</p>
                </header>
                <TopicList topics={DEV_REFERENCES} />
            </section>
        </div>
    </div>
);

export default AdminHelp;
