import { A, } from '@solidjs/router';
import { Component, createSignal, For, Show, } from 'solid-js';
import {
    ENTITIES,
    EVENT_EXAMPLES,
    EVENT_FUNCTION_ARGS,
    FUNCTIONS,
    GLOBAL_VARIABLES,
    LOGIC_EXAMPLES,
    OVERVIEW,
    SYNTAX_EXAMPLES,
    type EntityDoc,
} from '../../services/template/reference';
import './Help.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';
import HelpContents from '../../components/admin/help/HelpContents';

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

/** A property table (Events section): always open, unlike the collapsible entity list. */
const PropertyTable: Component<{ entity: EntityDoc | undefined; prefix: string; }> = (props,) => (
    <Show when={props.entity} fallback={<p class="form-help-muted">Property list unavailable.</p>}>
        {(e,) => (
            <table class="help-entity__table">
                <thead>
                    <tr><th>Property</th><th>Type</th><th>Notes</th></tr>
                </thead>
                <tbody>
                    <For each={e().fields}>
                        {(f,) => (
                            <tr>
                                <td><code>{props.prefix}{f.name}</code></td>
                                <td class="help-entity__type">{f.type}</td>
                                <td class="form-help-muted">{f.note ?? ''}</td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </table>
        )}
    </Show>
);

const APPLIES: Record<string, string> = { event: 'event()', events: 'events()', both: 'both', };

/** Events: properties, ticket tiers, function arguments, examples. */
const EventsSection: Component = () => (
    <section class="help-doc__section" id="events">
        <h2>Events</h2>
        <p class="form-help-muted">
            An event read in a template — <code>{"{{ event('summer-gala') }}"}</code>, a loop over{' '}
            <code>{'{{ events() }}'}</code>, an <code>event</code> entity template or the Events block — carries the
            properties below. Dates are already formatted in the event's own time zone for its NEXT date, and ticket
            types carry live availability, so a template never has to do date maths. Only events the viewer may see are
            returned; in server-rendered HTML and email the reader is anonymous, so only public events appear.
        </p>

        <h3>Event properties</h3>
        <PropertyTable entity={ENTITIES.find((e,) => e.kind === 'event',)} prefix="event." />

        <h3>Ticket types — <code>event.tiers[]</code></h3>
        <p class="form-help-muted">
            One entry per ticket type (empty when ticketing is off). Loop them with{' '}
            <code>{'{{ for event.tiers as t }} … {{ endfor }}'}</code>.
        </p>
        <PropertyTable entity={ENTITIES.find((e,) => e.name === 'EventTier',)} prefix="t." />

        <h3>Function arguments</h3>
        <p class="form-help-muted">
            Named arguments of <code>event(idOrSlug, …)</code> and <code>events(limit?, …)</code>. The display arguments
            are the same switches as the Events block's "Show on each card".
        </p>
        <table class="help-entity__table">
            <thead>
                <tr><th>Argument</th><th>For</th><th>Values</th><th>Notes</th></tr>
            </thead>
            <tbody>
                <For each={EVENT_FUNCTION_ARGS}>
                    {(a,) => (
                        <tr>
                            <td><code>{a.name}</code></td>
                            <td class="help-entity__type">{APPLIES[a.appliesTo] ?? a.appliesTo}</td>
                            <td class="help-entity__type">{a.values}</td>
                            <td class="form-help-muted">{a.desc}</td>
                        </tr>
                    )}
                </For>
            </tbody>
        </table>

        <h3>Examples</h3>
        <For each={EVENT_EXAMPLES}>
            {(ex,) => (
                <div class="help-doc__example help-doc__example--block">
                    <p class="help-doc__desc"><strong>{ex.title}.</strong> {ex.desc}</p>
                    <pre class="help-doc__pre">{ex.code}</pre>
                </div>
            )}
        </For>
        <p class="form-help-muted">
            The seeded <strong>Event Card</strong> template (Entities → Event → Templates) is a full example: one Custom
            HTML block that loops <code>event.tiers</code>, shows the access badge and styles itself with the site's
            colour and radius variables. Copy it to make your own card, then pick it in an Entity block.
        </p>
    </section>
);

const HelpVariables: Component = () => (
    <div class="admin-help help-doc">
        <AdminTitle>Variables &amp; Functions - Help</AdminTitle>
        <div class="admin-header">
            <A href="/admin/help" class="help-doc__back">&larr; Help</A>
            <h1>Variables &amp; Functions</h1>
            <HelpContents />
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
                                            <td class="form-help-muted">
                                                {fn.desc}
                                                {/* The worked example sits under the description
                                                    rather than in a third column: the signatures
                                                    are already long, and a third column would
                                                    squeeze all three into unreadable slivers on
                                                    anything narrower than a desktop. */}
                                                <Show when={fn.example}>
                                                    {(ex,) => (
                                                        <div class="help-doc__fn-example">
                                                            <code>{ex().code}</code>
                                                            <span class="help-doc__fn-arrow" aria-hidden="true">→</span>
                                                            <code class="help-doc__fn-result">{ex().result}</code>
                                                        </div>
                                                    )}
                                                </Show>
                                            </td>
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

        <EventsSection />
    </div>
);

export default HelpVariables;
