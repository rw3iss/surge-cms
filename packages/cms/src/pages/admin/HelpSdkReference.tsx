/**
 * SDK Reference (`/admin/help/sdk/reference`) — every `cms.*` module and
 * method, generated from the @sitesurge/client source.
 *
 * The data module is imported dynamically so it only loads on this page.
 */
import { A, } from '@solidjs/router';
import { Component, Show, createResource, } from 'solid-js';
import AdminTitle from '../../components/admin/common/AdminTitle';
import SdkModuleBrowser from '../../components/admin/help/SdkModuleBrowser';
import { API_REFERENCE_PATH, } from '../../components/admin/help/anchors';
import './Help.scss';
import HelpContents from '../../components/admin/help/HelpContents';

const HelpSdkReference: Component = () => {
    const [data,] = createResource(() => import('../../services/help/sdkModules.generated'),);

    return (
        <div class="help-doc help-ref">
            <AdminTitle>SDK Reference - Help</AdminTitle>
            <A href="/admin/help" class="help-doc__back">← Help</A>
            <div class="admin-header">
                <h1>SDK Reference</h1>
            <HelpContents />
            </div>
            <p class="help-doc__lead">
                Every namespace and method of <code>@sitesurge/client</code>
                <Show when={data()}>
                    {(d,) => <> — {d().SDK_MODULE_COUNT} modules, {d().SDK_METHOD_COUNT} methods</>}
                </Show>
                . Generated from the client source, so it always matches the SDK this site ships. Each
                method links to the <A href={API_REFERENCE_PATH}>API route</A> it calls; see{' '}
                <A href="/admin/help/sdk">Headless usage</A> for connecting and auth.
            </p>
            <Show when={data()} fallback={<p class="help-doc__desc">Loading reference…</p>}>
                {(d,) => <SdkModuleBrowser modules={d().SDK_MODULES} />}
            </Show>
        </div>
    );
};

export default HelpSdkReference;
