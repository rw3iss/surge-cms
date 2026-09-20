import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, For, Show, } from 'solid-js';
import {
    ENTITIES,
    FUNCTIONS,
    GLOBAL_VARIABLES,
    LOGIC_EXAMPLES,
    OVERVIEW,
    SYNTAX_EXAMPLES,
    type EntityDoc,
} from '../../services/template/reference';
import './Help.scss';

const EntitySection: Component<{ entity: EntityDoc; }> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    return (
        <div class="help-entity">
            <button
                type="button"
                class="help-entity__head"
                onClick={() => setOpen(!open(),)}
                aria-expanded={open()}
            >
                <span class="help-entity__chev">{open() ? '▾' : '▸'}</span>
                <span class="help-entity__name">{props.entity.name}</span>
                <code class="help-entity__kind">{props.entity.kind}</code>
                <span class="help-entity__desc">{props.entity.desc}</span>
            </button>
            <Show when={open()}>
                <table class="help-entity__table">
                    <thead>
                        <tr><th>Property</th><th>Type</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                        <For each={props.entity.fields}>
                            {(f,) => (
                                <tr>
                                    <td><code>{f.name}</code></td>
                                    <td class="help-entity__type">{f.type}</td>
                                    <td class="form-help-muted">{f.note ?? ''}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </Show>
        </div>
    );
};

const HelpVariables: Component = () => (
    <div class="admin-help help-doc">
        <Title>Variables &amp; Functions - Help - Admin - RW</Title>
        <div class="admin-header">
            <A href="/admin/help" class="help-doc__back">&larr; Help</A>
            <h1>Variables &amp; Functions</h1>
        </div>

        <p class="help-doc__lead">{OVERVIEW}</p>

        <section class="help-doc__section">
            <h2>Syntax</h2>
            <For each={SYNTAX_EXAMPLES}>
                {(ex,) => (
                    <div class="help-doc__example">
                        <code class="help-doc__code">{ex.code}</code>
                        <p class="help-doc__desc"><strong>{ex.title}.</strong> {ex.desc}</p>
                    </div>
                )}
            </For>
        </section>

        <section class="help-doc__section">
            <h2>Conditional &amp; loop logic</h2>
            <For each={LOGIC_EXAMPLES}>
                {(ex,) => (
                    <div class="help-doc__example help-doc__example--block">
                        <p class="help-doc__desc"><strong>{ex.title}.</strong> {ex.desc}</p>
                        <pre class="help-doc__pre">{ex.code}</pre>
                    </div>
                )}
            </For>
            <p class="form-help-muted">
                Conditions support <code>== != &gt; &lt; &gt;= &lt;=</code>, <code>and</code>, <code>or</code>,
                and <code>not</code>. Values are truthy unless empty/zero/false/null or an empty list.
            </p>
        </section>

        <section class="help-doc__section">
            <h2>Functions</h2>
            <For each={FUNCTIONS}>
                {(grp,) => (
                    <div class="help-doc__fn-group">
                        <h3>{grp.group}</h3>
                        <table class="help-doc__fn-table">
                            <tbody>
                                <For each={grp.items}>
                                    {(fn,) => (
                                        <tr>
                                            <td><code>{fn.sig}</code></td>
                                            <td class="form-help-muted">{fn.desc}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                )}
            </For>
        </section>

        <section class="help-doc__section">
            <h2>Site &amp; global variables</h2>
            <p class="form-help-muted">
                Available in every block, with no entity in scope. These resolve the same
                way on the site, in server-rendered HTML and in email.
            </p>
            <For each={GLOBAL_VARIABLES}>
                {(grp,) => (
                    <div class="help-doc__fn-group">
                        <h3>{grp.group}</h3>
                        <table class="help-doc__fn-table">
                            <tbody>
                                <For each={grp.items}>
                                    {(v,) => (
                                        <tr>
                                            <td><code>{v.path}</code></td>
                                            <td class="form-help-muted">{v.desc}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                )}
            </For>
        </section>

        <section class="help-doc__section">
            <h2>Entities &amp; schemas</h2>
            <p class="form-help-muted">
                Each entity type and its full property schema. Reference a property with
                dot access (e.g. <code>{'{{ post.title }}'}</code>), or render the whole
                entity with its function (e.g. <code>{'{{ form(id) }}'}</code>).
            </p>
            <For each={ENTITIES}>
                {(e,) => <EntitySection entity={e} />}
            </For>
        </section>
    </div>
);

export default HelpVariables;
