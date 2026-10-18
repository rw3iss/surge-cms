/**
 * The generated SDK module browser — every `cms.*` namespace and method.
 *
 * Takes the generated data as a prop so the caller can lazy-load it (the data
 * module is ~10k lines); see pages/admin/HelpSdkReference.tsx.
 */
import { A, } from '@solidjs/router';
import { Component, For, Show, } from 'solid-js';
import type { SdkMethodDoc, SdkModuleDoc, } from '../../../services/help/sdkModules.generated';
import CopyButton from './CopyButton';
import RefBrowser, { type RefGroup, type RefItem, type RefSection, } from './RefBrowser';
import { apiRouteHref, SDK_REFERENCE_PATH, } from './anchors';
import { inlineCode, } from './inlineCode';

const MethodView: Component<{ call: string; m: SdkMethodDoc; }> = (props,) => (
    <>
        <div class="ref-item__head">
            <code class="ref-item__name">{props.call}</code>
            <CopyButton text={props.m.signature} label="Copy signature" />
            <A href={`${SDK_REFERENCE_PATH}#${props.call}`} class="ref-item__hash" title="Link to this method">#</A>
        </div>
        <code class="ref-item__sig">{props.m.signature}</code>
        <Show when={props.m.summary}>
            <p class="ref-item__summary">{inlineCode(props.m.summary,)}</p>
        </Show>
        <Show when={props.m.params.length}>
            <table class="ref-item__fields">
                <caption>Parameters</caption>
                <tbody>
                    <For each={props.m.params}>
                        {(p,) => (
                            <tr>
                                <td><code>{p.name}</code></td>
                                <td><code class="ref-item__type">{p.type}</code></td>
                                <td>
                                    <Show when={p.optional} fallback={<span class="ref-item__req">required</span>}>
                                        <span class="ref-item__opt">
                                            optional{p.default !== undefined ? ` · default ${p.default}` : ''}
                                        </span>
                                    </Show>
                                    <Show when={p.doc}>
                                        {' '}— {inlineCode(p.doc!,)}
                                    </Show>
                                </td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </table>
        </Show>
        <Show when={props.m.returns}>
            <div class="ref-item__row">
                <span class="ref-item__label">Returns</span>
                <code class="ref-item__type">{props.m.returns}</code>
            </div>
        </Show>
        <Show when={props.m.routes.length}>
            <div class="ref-item__row">
                <span class="ref-item__label">API</span>
                <For each={props.m.routes}>
                    {(r,) => {
                        const [method, path,] = r.split(' ',);
                        return (
                            <A href={apiRouteHref(r,)} class="ref-item__link" title="Open in the API reference">
                                <span class={`ref-method ref-method--${method.toLowerCase()}`}>{method}</span>
                                <code>{path}</code>
                            </A>
                        );
                    }}
                </For>
            </div>
        </Show>
    </>
);

/** One module → a group; methods without a dot first, then one labelled
 *  section per sub-namespace (`cms.shop.products`). */
export function sdkGroups(modules: SdkModuleDoc[],): RefGroup[] {
    return modules.map((mod,) => {
        const prefix = `cms.${mod.namespace}`;
        const item = (m: SdkMethodDoc,): RefItem => {
            const call = `${prefix}.${m.name}`;
            return {
                anchor: call,
                search: `${call} ${m.signature} ${m.summary} ${m.routes.join(' ',)}`.toLowerCase(),
                render: () => <MethodView call={call} m={m} />,
            };
        };
        const sections: RefSection[] = [{ items: mod.methods.filter((m,) => !m.name.includes('.',)).map(item,), },];
        const subs = new Map<string, SdkMethodDoc[]>();
        for (const m of mod.methods) {
            const dot = m.name.indexOf('.',);
            if (dot === -1) continue;
            const sub = m.name.slice(0, dot,);
            subs.set(sub, [...(subs.get(sub,) ?? []), m,],);
        }
        for (const [sub, methods,] of subs) {
            sections.push({ id: `${prefix}.${sub}`, label: `${prefix}.${sub}`, items: methods.map(item,), },);
        }
        return {
            id: prefix,
            label: prefix,
            meta: mod.className,
            description: mod.summary,
            search: `${prefix} ${mod.className}`.toLowerCase(),
            sections,
        };
    },);
}

const SdkModuleBrowser: Component<{ modules: SdkModuleDoc[]; }> = (props,) => (
    <RefBrowser
        groups={sdkGroups(props.modules,)}
        basePath={SDK_REFERENCE_PATH}
        placeholder="Filter by module, method or text…"
        noun={['method', 'methods',]}
    />
);

export default SdkModuleBrowser;
