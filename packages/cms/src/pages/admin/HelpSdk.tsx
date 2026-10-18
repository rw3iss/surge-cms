/**
 * SDK documentation pages (`/admin/help/sdk/*`).
 *
 * One renderer for all three docs — they differ only in content, and three
 * near-identical components is how two of them quietly fall out of date.
 * Content lives in `services/help/sdkReference.ts`.
 */
import { A, } from '@solidjs/router';
import { Component, For, Show, } from 'solid-js';
import { COMPONENT_JS_DOC, DISCUSSIONS_DOC, GALLERY_DOC, HEADLESS_DOC, LIVE_SHOWS_DOC, MODULES_DOC, PERMISSIONS_DOC, POST_TYPES_DOC, REFERENCE_LINKS, RELEASES_DOC, SDK_DOCS, type SdkDoc, VIDEO_DOC, } from '../../services/help/sdkReference';
import { inlineCode, } from '../../components/admin/help/inlineCode';
import './Help.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';

const DocPage: Component<{ doc: SdkDoc; }> = (props,) => (
    <div class="help-doc">
        <AdminTitle>{props.doc.title} - Help</AdminTitle>
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
            {/* The generated references belong to the same guide. */}
            <For each={REFERENCE_LINKS}>
                {(l,) => <A href={l.href} class="help-doc__sibling help-doc__sibling--ref">{l.label}</A>}
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

                                <Show when={b.links}>
                                    <div class="help-doc__links">
                                        <For each={b.links}>
                                            {(l,) => (
                                                <A href={l.href} class="admin-help__card help-doc__link-card">
                                                    <h3 class="admin-help__card-title">{l.label}</h3>
                                                    <p class="admin-help__card-desc">{l.desc}</p>
                                                </A>
                                            )}
                                        </For>
                                    </div>
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
export const HelpReleases: Component = () => <DocPage doc={RELEASES_DOC} />;
export const HelpSdkComponentJs: Component = () => <DocPage doc={COMPONENT_JS_DOC} />;
export const HelpVideo: Component = () => <DocPage doc={VIDEO_DOC} />;
export const HelpPostTypes: Component = () => <DocPage doc={POST_TYPES_DOC} />;
export const HelpDiscussions: Component = () => <DocPage doc={DISCUSSIONS_DOC} />;
export const HelpGallery: Component = () => <DocPage doc={GALLERY_DOC} />;
export const HelpLiveShows: Component = () => <DocPage doc={LIVE_SHOWS_DOC} />;

export default HelpSdkHeadless;
