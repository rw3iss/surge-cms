import { A, } from '@solidjs/router';
import { Component, For, } from 'solid-js';
import './Help.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';

interface HelpTopic { path: string; title: string; desc: string; }

/** Admin documentation index. New help topics get added here as the CMS grows. */
const TOPICS: HelpTopic[] = [
    {
        path: '/admin/help/sdk',
        title: 'Headless usage & SDK',
        desc: 'Talk to this CMS from your own app — connecting, auth modes, and what the typed client returns.',
    },
    {
        path: '/admin/help/sdk/modules',
        title: 'Creating a feature module',
        desc: 'Add an installable feature at the code level: registry entry, migrations, repo/service/routes, DTOs.',
    },
    {
        path: '/admin/help/sdk/permissions',
        title: 'Permissions in a module',
        desc: 'Declare and check granular permissions from backend code, and how precedence resolves.',
    },
    {
        path: '/admin/help/sdk/component-js',
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
        desc: 'Article, Video, Live Show and Custom posts — and how to create your own post type: register it, add a custom editor form, a gated sample and a public display.',
    },
    {
        path: '/admin/help/video',
        title: 'Video hosting',
        desc: 'Upload large videos, how encoding works, public vs private videos and teasers, using a video in a block, and server setup.',
    },
    {
        path: '/admin/help/variables-and-functions',
        title: 'Variables & Functions',
        desc: 'The {{ … }} template syntax for content blocks — variables, entity lookups, if/for logic, and every function + entity schema.',
    },
];

const AdminHelp: Component = () => (
    <div class="admin-help">
        <AdminTitle>Help</AdminTitle>
        <div class="admin-header">
            <h1>Help &amp; Documentation</h1>
        </div>
        <p class="form-help-muted admin-help__intro">
            Reference documentation for this Surge CMS site.
        </p>
        <div class="admin-help__topics">
            <For each={TOPICS}>
                {(t,) => (
                    <A href={t.path} class="admin-help__card">
                        <h2 class="admin-help__card-title">{t.title}</h2>
                        <p class="admin-help__card-desc">{t.desc}</p>
                    </A>
                )}
            </For>
        </div>
    </div>
);

export default AdminHelp;
