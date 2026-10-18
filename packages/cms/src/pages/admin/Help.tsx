import { A, } from '@solidjs/router';
import { Component, createMemo, createSignal, For, Show, } from 'solid-js';
import './Help.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';
import { byFeature, DEV_REFERENCES, matches, SECTIONS, topicFeatureOn, type HelpTopic, } from '../../services/help/helpTopics';

const TopicList: Component<{ topics: HelpTopic[]; }> = (props,) => (
    <div class="admin-help__topics">
        <For each={props.topics} fallback={<p class="form-help-muted">No matching topics.</p>}>
            {(t,) => (
                <A href={t.path} class="admin-help__card" classList={{ 'admin-help__card--off': !topicFeatureOn(t,), }}>
                    <h3 class="admin-help__card-title">
                        {t.title}
                        <Show when={!topicFeatureOn(t,)}><span class="admin-help__card-off"> (feature off)</span></Show>
                    </h3>
                    <p class="admin-help__card-desc">{t.desc}</p>
                </A>
            )}
        </For>
    </div>
);

const AdminHelp: Component = () => {
    // Search-as-you-type filter (local only — nothing is lifted or fetched).
    const [query, setQuery,] = createSignal('',);
    const q = () => query().trim().toLowerCase();
    const sections = createMemo(() => byFeature(SECTIONS.filter((t,) => matches(t, q(),),),),);
    const devRefs = createMemo(() => DEV_REFERENCES.filter((t,) => matches(t, q(),),),);
    return (
    <div class="admin-help">
        <AdminTitle>Help</AdminTitle>
        <div class="admin-header">
            <h1>Help &amp; Documentation</h1>
        </div>
        <p class="form-help-muted admin-help__intro">
            Reference documentation for this Surge CMS site.
        </p>
        <input
            type="search"
            class="admin-help__filter"
            placeholder="Filter topics…"
            aria-label="Filter help topics"
            value={query()}
            onInput={(e,) => setQuery(e.currentTarget.value,)}
        />
        {/* Two columns on wide screens; below 900px one column, with the
            developer references after the general sections (DOM order). */}
        <div class="admin-help__columns">
            <section class="admin-section admin-help__group">
                <header class="admin-section__header">
                    <h2>Topics</h2>
                    <p class="form-help-muted">Guides to the site's features.</p>
                </header>
                <TopicList topics={sections()} />
            </section>
            <section class="admin-section admin-help__group">
                <header class="admin-section__header">
                    <h2>Developer References</h2>
                    <p class="form-help-muted">The SDK, the REST API, modules, permissions and templating.</p>
                </header>
                <TopicList topics={devRefs()} />
            </section>
        </div>
    </div>
    );
};

export default AdminHelp;
