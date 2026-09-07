/**
 * SDK documentation pages (`/admin/help/sdk/*`).
 *
 * One renderer for all three docs — they differ only in content, and three
 * near-identical components is how two of them quietly fall out of date.
 * Content lives in `services/help/sdkReference.ts`.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, For, Show, createSignal, type JSX, } from 'solid-js';
import { COMPONENT_JS_DOC, HEADLESS_DOC, MODULES_DOC, PERMISSIONS_DOC, SDK_DOCS, type SdkDoc, } from '../../services/help/sdkReference';
import { SDK_METHOD_COUNT, SDK_MODULE_COUNT, SDK_MODULES, type SdkModuleDoc, } from '../../services/help/sdkModules.generated';
import './Help.scss';

/**
 * Render `backtick` spans as <code>.
 *
 * The doc data is written in a markdown-ish style and every page already used
 * backticks in prose, but the renderer emitted them as literal characters —
 * so `mount(el, ctx)` read as punctuation rather than code. Split rather than
 * `innerHTML`: the text is authored in-repo, but building nodes keeps it
 * impossible for a doc string to inject markup.
 */
function inlineCode(text: string,): JSX.Element {
    const parts = text.split('`',);
    // Odd indices are the spans between backticks; an unmatched trailing
    // backtick just leaves its text as prose.
    return <>{parts.map((part, i,) => (i % 2 === 1 ? <code>{part}</code> : part))}</>;
}

/**
 * The generated SDK module browser.
 *
 * One collapsible section per `cms.*` namespace, each listing every method with
 * its signature. Collapsed by default: 39 modules and 365 methods expanded at
 * once is a wall, and a reader almost always wants one namespace.
 *
 * The data is generated from the client source (scripts/generate-sdk-modules.ts)
 * and guarded by sdkModules.test.ts, so this can't drift from the real SDK.
 */
const SdkModuleReference: Component = () => {
    const [open, setOpen,] = createSignal<string | null>(null,);
    const [filter, setFilter,] = createSignal('',);

    const matches = (m: SdkModuleDoc,): boolean => {
        const q = filter().trim().toLowerCase();
        if (!q) return true;
        return m.namespace.toLowerCase().includes(q,)
            || m.methods.some((f,) => f.name.toLowerCase().includes(q,));
    };

    /** With a filter active, show only the methods that match it. */
    const methodsOf = (m: SdkModuleDoc,) => {
        const q = filter().trim().toLowerCase();
        if (!q || m.namespace.toLowerCase().includes(q,)) return m.methods;
        return m.methods.filter((f,) => f.name.toLowerCase().includes(q,));
    };

    const visible = () => SDK_MODULES.filter(matches,);

    return (
        <section class="help-doc__section sdk-modules">
            <h2>Module reference</h2>
            <p class="help-doc__desc">
                Every namespace on <code>ctx.cms</code> — {SDK_MODULE_COUNT} modules,
                {' '}{SDK_METHOD_COUNT} methods. Generated from the client source.
            </p>

            <input
                type="search"
                class="sdk-modules__filter"
                placeholder="Filter modules and methods…"
                value={filter()}
                onInput={(e,) => setFilter(e.currentTarget.value,)}
                aria-label="Filter SDK modules and methods"
            />

            <Show
                when={visible().length > 0}
                fallback={<p class="help-doc__desc">No module or method matches that.</p>}
            >
                <For each={visible()}>
                    {(m,) => (
                        <div class="sdk-modules__module">
                            <button
                                type="button"
                                class="sdk-modules__toggle"
                                aria-expanded={open() === m.namespace}
                                onClick={() => setOpen((cur,) => (cur === m.namespace ? null : m.namespace))}
                            >
                                <span class="sdk-modules__chevron">
                                    {open() === m.namespace ? '▼' : '▶'}
                                </span>
                                <code class="sdk-modules__ns">cms.{m.namespace}</code>
                                <span class="sdk-modules__count">
                                    {methodsOf(m,).length} method{methodsOf(m,).length === 1 ? '' : 's'}
                                </span>
                            </button>

                            <Show when={open() === m.namespace}>
                                <div class="sdk-modules__body">
                                    <Show when={m.summary}>
                                        <p class="help-doc__desc">{inlineCode(m.summary,)}</p>
                                    </Show>
                                    <ul class="sdk-modules__methods">
                                        <For each={methodsOf(m,)}>
                                            {(f,) => (
                                                <li>
                                                    <code class="sdk-modules__sig">{f.signature}</code>
                                                    <Show when={f.summary}>
                                                        <span class="sdk-modules__summary">{f.summary}</span>
                                                    </Show>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </div>
                            </Show>
                        </div>
                    )}
                </For>
            </Show>
        </section>
    );
};

const DocPage: Component<{ doc: SdkDoc; }> = (props,) => (
    <div class="help-doc">
        <Title>{props.doc.title} - Help - Admin</Title>
        <A href="/admin/help" class="help-doc__back">← Help</A>
        <div class="admin-header">
            <h1>{props.doc.title}</h1>
        </div>

        <p class="help-doc__lead">{props.doc.lead}</p>

        {/* Sibling nav: these three read as one guide, so each page links to
            the others rather than sending the reader back to the index. */}
        <nav class="help-doc__siblings">
            <For each={SDK_DOCS}>
                {(d,) => (
                    <A
                        href={d.path}
                        class={`help-doc__sibling${
                            d.id === props.doc.id ? ' help-doc__sibling--current' : ''
                        }`}
                    >
                        {d.title}
                    </A>
                )}
            </For>
        </nav>

        <For each={props.doc.sections}>
            {(section,) => (
                <section class="help-doc__section">
                    <h2>{section.heading}</h2>
                    <For each={section.blocks}>
                        {(b,) => (
                            <>
                                <Show when={b.p}>
                                    <p class="help-doc__desc">{inlineCode(b.p!,)}</p>
                                </Show>

                                <Show when={b.note}>
                                    <p class="help-doc__note">{inlineCode(b.note!,)}</p>
                                </Show>

                                <Show when={b.list}>
                                    <ul class="help-doc__list">
                                        <For each={b.list}>{(item,) => <li>{inlineCode(item,)}</li>}</For>
                                    </ul>
                                </Show>

                                <Show when={b.code}>
                                    <pre class="help-doc__pre"><code>{b.code}</code></pre>
                                </Show>

                                <Show when={b.table}>
                                    {(rows,) => (
                                        <table class="help-doc__fn-table">
                                            <thead>
                                                <tr>
                                                    <For each={rows()[0]}>{(h,) => <th>{h}</th>}</For>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <For each={rows().slice(1,)}>
                                                    {(row,) => (
                                                        <tr>
                                                            <For each={row}>{(cell,) => <td>{inlineCode(cell,)}</td>}</For>
                                                        </tr>
                                                    )}
                                                </For>
                                            </tbody>
                                        </table>
                                    )}
                                </Show>
                            </>
                        )}
                    </For>
                </section>
            )}
        </For>
        <Show when={props.doc.showModuleReference}>
            <SdkModuleReference />
        </Show>
    </div>
);

export const HelpSdkHeadless: Component = () => <DocPage doc={HEADLESS_DOC} />;
export const HelpSdkModules: Component = () => <DocPage doc={MODULES_DOC} />;
export const HelpSdkPermissions: Component = () => <DocPage doc={PERMISSIONS_DOC} />;
export const HelpSdkComponentJs: Component = () => <DocPage doc={COMPONENT_JS_DOC} />;

export default HelpSdkHeadless;
