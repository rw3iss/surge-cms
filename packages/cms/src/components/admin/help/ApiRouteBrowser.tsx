/**
 * The generated API route browser — every route in the manifest, with its
 * auth tier, input fields and the SDK method(s) that call it.
 *
 * Takes the generated data as a prop so the caller can lazy-load it; see
 * pages/admin/HelpApiReference.tsx.
 */
import { A, } from '@solidjs/router';
import { Component, For, Show, createSignal, } from 'solid-js';
import type { ApiFieldDoc, ApiModuleDoc, ApiRouteDoc, } from '../../../services/help/apiReference.generated';
import CopyButton from './CopyButton';
import RefBrowser, { type RefGroup, type RefItem, } from './RefBrowser';
import { API_REFERENCE_PATH, apiAnchor, sdkMethodHref, } from './anchors';
import { inlineCode, } from './inlineCode';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE',];
const TIERS = ['public', 'optional', 'user', 'staff', 'admin', 'apiKey',];

const TIER_HINT: Record<string, string> = {
    public: 'Anyone, no credentials',
    optional: 'Anyone; signed-in users and API keys get a richer response',
    user: 'Any signed-in user',
    staff: 'Editor, admin or sysadmin — or an ssk_ API key',
    admin: 'Admin or sysadmin — or an ssk_ API key',
    apiKey: 'Admin or an ssk_ API key (machine-client route)',
};

const Fields: Component<{ title: string; fields?: ApiFieldDoc[]; }> = (props,) => (
    <Show when={props.fields?.length}>
        <table class="ref-item__fields">
            <caption>{props.title}</caption>
            <tbody>
                <For each={props.fields}>
                    {(f,) => (
                        <tr>
                            <td><code>{f.name}</code></td>
                            <td><code class="ref-item__type">{f.type}</code></td>
                            <td>
                                <Show when={f.required} fallback={<span class="ref-item__opt">optional</span>}>
                                    <span class="ref-item__req">required</span>
                                </Show>
                                <Show when={f.description}>{' '}— {f.description}</Show>
                            </td>
                        </tr>
                    )}
                </For>
            </tbody>
        </table>
    </Show>
);

const RouteView: Component<{ r: ApiRouteDoc; }> = (props,) => {
    const key = () => `${props.r.method} ${props.r.absolutePath}`;
    return (
        <>
            <div class="ref-item__head">
                <span class={`ref-method ref-method--${props.r.method.toLowerCase()}`}>{props.r.method}</span>
                <code class="ref-item__name">{props.r.absolutePath}</code>
                <CopyButton text={props.r.absolutePath} label="Copy path" />
                <span class={`ref-pill ref-pill--${props.r.auth}`} title={TIER_HINT[props.r.auth] ?? ''}>
                    {props.r.auth}
                </span>
                <Show when={props.r.raw}>
                    <span class="ref-pill" title="Responds outside the JSON envelope (stream, redirect, XML, HTML…)">raw</span>
                </Show>
                <A href={`${API_REFERENCE_PATH}#${apiAnchor(key(),)}`} class="ref-item__hash" title="Link to this route">#</A>
            </div>
            <Show when={props.r.summary}>
                <p class="ref-item__summary">{inlineCode(props.r.summary,)}</p>
            </Show>
            <Fields title="Path params" fields={props.r.input?.params} />
            <Fields title="Query" fields={props.r.input?.query} />
            <Fields title="Body" fields={props.r.input?.body} />
            <div class="ref-item__row">
                <span class="ref-item__label">SDK</span>
                <Show when={props.r.sdkStatus === 'method'}>
                    <For each={props.r.sdk}>
                        {(call,) => (
                            <A href={sdkMethodHref(call,)} class="ref-item__link" title="Open in the SDK reference">
                                <code>{call}()</code>
                            </A>
                        )}
                    </For>
                </Show>
                <Show when={props.r.sdkStatus === 'covered'}>
                    <span class="ref-item__muted">Listed in the SDK coverage map; no method found that calls it.</span>
                </Show>
                <Show when={props.r.sdkStatus === 'unexposed'}>
                    <span class="ref-item__muted">Deliberately not in the SDK (called by a player, a redirect or a third party).</span>
                </Show>
                <Show when={props.r.sdkStatus === 'none'}>
                    <span class="ref-item__muted">Not in the SDK — call it over HTTP.</span>
                </Show>
            </div>
        </>
    );
};

export function apiGroups(modules: ApiModuleDoc[],): RefGroup[] {
    return modules.map((mod,) => ({
        id: `api-${mod.module}`,
        label: mod.module,
        meta: mod.mountPath || '(site root)',
        description: mod.feature ? `Requires the \`${mod.feature}\` feature — its routes 404 while the feature is off.` : undefined,
        search: `${mod.module} ${mod.mountPath} ${mod.feature ?? ''}`.toLowerCase(),
        sections: [{
            items: mod.routes.map((r,): RefItem & { route: ApiRouteDoc; } => ({
                route: r,
                anchor: apiAnchor(`${r.method} ${r.absolutePath}`,),
                search: `${r.method} ${r.absolutePath} ${r.auth} ${r.summary} ${r.sdk.join(' ',)}`.toLowerCase(),
                render: () => <RouteView r={r} />,
            })),
        },],
    }));
}

const ApiRouteBrowser: Component<{ modules: ApiModuleDoc[]; }> = (props,) => {
    const [method, setMethod,] = createSignal('',);
    const [tier, setTier,] = createSignal('',);
    const routeOf = (it: RefItem,) => (it as RefItem & { route: ApiRouteDoc; }).route;

    return (
        <RefBrowser
            groups={apiGroups(props.modules,)}
            basePath={API_REFERENCE_PATH}
            placeholder="Filter by path, module, method or text…"
            noun={['route', 'routes',]}
            itemFilter={(it,) => (!method() || routeOf(it,).method === method()) && (!tier() || routeOf(it,).auth === tier())}
            itemFilterActive={() => !!method() || !!tier()}
            onClearItemFilter={() => { setMethod('',); setTier('',); }}
            toolbar={
                <>
                    <select value={method()} onChange={(e,) => setMethod(e.currentTarget.value,)} aria-label="HTTP method">
                        <option value="">All methods</option>
                        <For each={METHODS}>{(m,) => <option value={m}>{m}</option>}</For>
                    </select>
                    <select value={tier()} onChange={(e,) => setTier(e.currentTarget.value,)} aria-label="Auth tier">
                        <option value="">All auth tiers</option>
                        <For each={TIERS}>{(t,) => <option value={t}>{t}</option>}</For>
                    </select>
                </>
            }
        />
    );
};

export default ApiRouteBrowser;
