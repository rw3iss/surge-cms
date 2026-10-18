/**
 * "Help contents" — a small dropdown on every help page (in the header, right)
 * listing all Topics and Developer References, with the page being viewed
 * marked. Populated from the help registry (services/help/helpTopics.ts), the
 * same list the /admin/help index renders, so new pages appear automatically.
 * Two columns on wide screens, one below 640px (references after topics).
 */
import { A, useLocation, } from '@solidjs/router';
import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { helpGroups, topicFeatureOn, type HelpTopic, } from '../../../services/help/helpTopics';
import './HelpContents.scss';

const HelpContents: Component = () => {
    const location = useLocation();
    const [open, setOpen,] = createSignal(false,);
    let root: HTMLDivElement | undefined;
    let button: HTMLButtonElement | undefined;
    const groups = helpGroups();
    /** The current page — exact path (so /admin/help/sdk is not "current" on /sdk/reference). */
    const isCurrent = (t: HelpTopic,) => location.pathname.replace(/\/+$/, '',) === t.path;

    onMount(() => {
        const onDown = (e: MouseEvent,) => { if (open() && root && !root.contains(e.target as Node,)) setOpen(false,); };
        const onKey = (e: KeyboardEvent,) => {
            if (e.key === 'Escape' && open()) { setOpen(false,); button?.focus(); }
        };
        document.addEventListener('mousedown', onDown,);
        document.addEventListener('keydown', onKey,);
        onCleanup(() => { document.removeEventListener('mousedown', onDown,); document.removeEventListener('keydown', onKey,); },);
    },);

    const list = (title: string, items: HelpTopic[],) => (
        <section class="help-contents__group" aria-label={title}>
            <h3 class="help-contents__heading">{title}</h3>
            <ul class="help-contents__list">
                <For each={items}>
                    {(t,) => (
                        <li>
                            <A
                                href={t.path}
                                class="help-contents__link"
                                classList={{ 'is-current': isCurrent(t,), 'is-off': !topicFeatureOn(t,), }}
                                aria-current={isCurrent(t,) ? 'page' : undefined}
                                onClick={() => setOpen(false,)}
                            >
                                {t.title}
                                <Show when={!topicFeatureOn(t,)}><span class="help-contents__off"> (off)</span></Show>
                            </A>
                        </li>
                    )}
                </For>
            </ul>
        </section>
    );

    return (
        <div class="help-contents" ref={root}>
            <button
                ref={button}
                type="button"
                class="ui-button ui-button--secondary ui-button--sm help-contents__toggle"
                aria-haspopup="true"
                aria-expanded={open()}
                onClick={() => setOpen(!open(),)}
            >
                Help contents <span aria-hidden="true">▾</span>
            </button>
            <Show when={open()}>
                <div class="help-contents__panel" role="navigation" aria-label="Help contents">
                    {list('Topics', groups.topics,)}
                    {list('Developer References', groups.references,)}
                    <A href="/admin/help" class="help-contents__all" onClick={() => setOpen(false,)}>All help →</A>
                </div>
            </Show>
        </div>
    );
};

export default HelpContents;
