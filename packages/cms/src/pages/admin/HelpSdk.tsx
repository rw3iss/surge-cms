/**
 * SDK documentation pages (`/admin/help/sdk/*`).
 *
 * One renderer for all three docs — they differ only in content, and three
 * near-identical components is how two of them quietly fall out of date.
 * Content lives in `services/help/sdkReference.ts`.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, For, Show, type JSX, } from 'solid-js';
import { COMPONENT_JS_DOC, HEADLESS_DOC, MODULES_DOC, PERMISSIONS_DOC, SDK_DOCS, type SdkDoc, } from '../../services/help/sdkReference';
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
    </div>
);

export const HelpSdkHeadless: Component = () => <DocPage doc={HEADLESS_DOC} />;
export const HelpSdkModules: Component = () => <DocPage doc={MODULES_DOC} />;
export const HelpSdkPermissions: Component = () => <DocPage doc={PERMISSIONS_DOC} />;
export const HelpSdkComponentJs: Component = () => <DocPage doc={COMPONENT_JS_DOC} />;

export default HelpSdkHeadless;
