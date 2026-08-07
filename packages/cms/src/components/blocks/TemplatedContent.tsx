import { Component, createMemo, createResource, For, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { hasTemplateSyntax, renderTemplate, } from '../../services/template';
import { buildRuntime, type RuntimeOptions, } from '../../services/template/runtime';
import { useUser, } from '../../stores/auth';
import { siteSettings, } from '../../stores/siteSettings';
import TemplateEntity from './TemplateEntity';
import './TemplatedContent.scss';

interface TemplatedContentProps {
    /** Raw block HTML/text, possibly containing `{{ … }}`. */
    html: string | null | undefined;
    /** Page-entity context, e.g. `{ post: { kind:'post', data, id } }`. */
    entities?: RuntimeOptions['entities'];
    /** Class applied to the wrapping element (e.g. `rich-text`). */
    class?: string;
}

interface EntitySeg { index: number; kind: string; data: Record<string, unknown> | null; options?: Record<string, unknown>; }
interface Resolved { html: string; entities: EntitySeg[]; }

/** Strip `{{ … }}` tags — used for the loading fallback so raw braces never
 *  flash before the template resolves. */
function stripTags(html: string): string {
    return html.replace(/\{\{[^{}]*\}\}/g, '');
}

/**
 * Renders block content, resolving any `{{ … }}` template syntax against the CMS
 * runtime (variables, entity functions, if/for). Content with no template syntax
 * renders identically to a plain `innerHTML` div — zero overhead.
 *
 * Whole-entity refs (`{{form(id)}}`) render IN PLACE: the full resolved HTML is
 * injected once (so surrounding markup structure is preserved, not split at the
 * ref), leaving an empty `display:contents` placeholder at each ref position;
 * each entity component is then `Portal`-mounted into its placeholder — so it
 * lands exactly where the `{{ … }}` was, inside whatever element contains it.
 */
const TemplatedContent: Component<TemplatedContentProps> = (props,) => {
    const auth = useUser();
    // Track only the user IDENTITY, not the user object. The auth store re-issues
    // a NEW user object on every tab-focus / visibility re-verify (see
    // stores/auth). Reading `auth.user?.id` directly in the resource source made
    // the template re-resolve — and the `keyed` <Show> below then destroyed and
    // recreated every embedded entity — on each focus event. That nuked stateful
    // embeds like the donation form (Stripe Card Element) mid-interaction, e.g.
    // when the Stripe/Link popup returns focus to the page. A memo de-dupes so a
    // same-id refresh is a no-op; a real login/logout (id change) still re-resolves.
    const uid = createMemo(() => auth.user?.id ?? null,);

    const [resolved] = createResource(
        () => ({ html: props.html ?? '', entities: props.entities, uid: uid() }),
        async (src): Promise<Resolved> => {
            if (!hasTemplateSyntax(src.html)) return { html: src.html, entities: [], };
            const u = auth.user;
            const rt = buildRuntime({
                entities: src.entities,
                user: u
                    ? { name: u.displayName, displayName: u.displayName, email: u.email, role: u.role, id: u.id, avatarUrl: u.avatarUrl }
                    : null,
                site: (siteSettings() ?? null) as Record<string, unknown> | null,
            },);
            const nodes = await renderTemplate(src.html, rt,);
            // Flatten to ONE HTML string, replacing each whole-entity segment with
            // a `display:contents` placeholder we Portal the component into.
            const entities: EntitySeg[] = [];
            let out = '';
            for (const n of nodes) {
                if (n.type === 'html') {
                    out += n.html;
                } else {
                    const index = entities.length;
                    entities.push({ index, kind: n.kind, data: n.data, options: n.options, },);
                    out += `<div style="display:contents" data-tpl-entity="${index}"></div>`;
                }
            }
            return { html: out, entities, };
        },
    );

    return (
        <Show
            when={resolved()}
            keyed
            fallback={<div class={props.class} innerHTML={stripTags(props.html ?? '',)} />}
        >
            {(r) => {
                // The container's innerHTML is applied when this element is
                // created (before the <For> below runs), so the placeholders
                // exist by the time we query for them.
                let container: HTMLDivElement | undefined;
                return (
                    <>
                        <div class={props.class} innerHTML={r.html} ref={container} />
                        <For each={r.entities}>
                            {(e) => {
                                const target = container?.querySelector(`[data-tpl-entity="${e.index}"]`,) as HTMLElement | null;
                                return (
                                    <Show when={target}>
                                        <Portal mount={target!}>
                                            <TemplateEntity kind={e.kind} data={e.data} options={e.options} />
                                        </Portal>
                                    </Show>
                                );
                            }}
                        </For>
                    </>
                );
            }}
        </Show>
    );
};

export default TemplatedContent;
