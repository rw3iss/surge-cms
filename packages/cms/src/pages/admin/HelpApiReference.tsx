/**
 * API Reference (`/admin/help/api`) — every REST route, generated from the
 * route manifest (docs/api-manifest.json) with the SDK method that calls it.
 *
 * The data module is imported dynamically so it only loads on this page.
 */
import { A, } from '@solidjs/router';
import { Component, Show, createResource, } from 'solid-js';
import AdminTitle from '../../components/admin/common/AdminTitle';
import ApiRouteBrowser from '../../components/admin/help/ApiRouteBrowser';
import { SDK_REFERENCE_PATH, } from '../../components/admin/help/anchors';
import './Help.scss';
import HelpContents from '../../components/admin/help/HelpContents';

const HelpApiReference: Component = () => {
    const [data,] = createResource(() => import('../../services/help/apiReference.generated'),);

    return (
        <div class="help-doc help-ref">
            <AdminTitle>API Reference - Help</AdminTitle>
            <A href="/admin/help" class="help-doc__back">← Help</A>
            <div class="admin-header">
                <h1>API Reference</h1>
            <HelpContents />
            </div>
            <p class="help-doc__lead">
                Every REST route this site serves
                <Show when={data()}>
                    {(d,) => <> — {d().API_ROUTE_COUNT} routes in {d().API_MODULE_COUNT} modules</>}
                </Show>
                . Generated from the server's route manifest, so it always matches the running API. From
                TypeScript, prefer the typed <A href={SDK_REFERENCE_PATH}>SDK</A> — each route names the
                method that calls it.
            </p>

            <div class="ref-notes">
                <div class="ref-notes__card">
                    <h2>Base URL &amp; envelope</h2>
                    <p>
                        JSON routes live under <code>/api/v1</code> on this site's origin (e.g.{' '}
                        <code>{window.location.origin}/api/v1/posts</code>). A few raw routes (<code>/feed.xml</code>,{' '}
                        <code>/sitemap.xml</code>, <code>/u/:token</code>) are root-mounted.
                    </p>
                    <p>
                        Responses: <code>{'{ success: true, data, meta? }'}</code> or{' '}
                        <code>{'{ success: false, error: { code, message, details? } }'}</code>. <code>meta</code>{' '}
                        (page / limit / total / totalPages) appears on paginated lists. Routes marked{' '}
                        <span class="ref-pill">raw</span> respond outside the envelope.
                    </p>
                </div>
                <div class="ref-notes__card">
                    <h2>Authentication</h2>
                    <ul>
                        <li><strong>Cookie</strong> — the browser session; mutations also need the <code>x-csrf-token</code> header (echo the <code>csrf-token</code> cookie).</li>
                        <li><strong>Bearer JWT</strong> — <code>Authorization: Bearer &lt;accessToken&gt;</code> from <code>POST /api/v1/auth/login</code>.</li>
                        <li><strong>API key</strong> — <code>Authorization: Bearer ssk_…</code> (Settings → API Keys). GET needs <code>read</code>, mutations <code>write</code>. Bearer requests skip CSRF.</li>
                    </ul>
                </div>
                <div class="ref-notes__card">
                    <h2>Auth tiers</h2>
                    <ul>
                        <li><span class="ref-pill ref-pill--public">public</span> anyone · <span class="ref-pill">optional</span> anyone, richer when signed in</li>
                        <li><span class="ref-pill">user</span> any signed-in user</li>
                        <li><span class="ref-pill ref-pill--staff">staff</span> editor / admin / sysadmin, or an API key</li>
                        <li><span class="ref-pill ref-pill--admin">admin</span> / <span class="ref-pill ref-pill--apiKey">apiKey</span> admin or an API key</li>
                    </ul>
                    <p>Many routes also check a permission inside the handler (Settings → Permissions); the tier is the floor.</p>
                </div>
            </div>

            <Show when={data()} fallback={<p class="help-doc__desc">Loading reference…</p>}>
                {(d,) => <ApiRouteBrowser modules={d().API_MODULES} />}
            </Show>
        </div>
    );
};

export default HelpApiReference;
