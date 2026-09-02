import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, For, } from 'solid-js';
import './Help.scss';

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
        path: '/admin/help/variables-and-functions',
        title: 'Variables & Functions',
        desc: 'The {{ … }} template syntax for content blocks — variables, entity lookups, if/for logic, and every function + entity schema.',
    },
];

const AdminHelp: Component = () => (
    <div class="admin-help">
        <Title>Help - Admin - RW</Title>
        <div class="admin-header">
            <h1>Help &amp; Documentation</h1>
        </div>
        <p class="form-help-muted admin-help__intro">
            Reference documentation for this SiteSurge CMS site.
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
