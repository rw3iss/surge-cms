import type { FacebookPageOption, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { FormField, } from '../forms';

/**
 * Facebook Page picker: lists the Pages the saved user token manages and saves
 * the chosen one (its id, Page token and the granted scopes) for analytics.
 * Pages where the user lacks the ANALYZE task are marked — insights need it.
 */
const FacebookPagePicker: Component<{ onSaved?: (msg: string,) => void; }> = (props,) => {
    const [pages, { refetch, },] = createResource(async () => {
        try {
            return { list: await cms.connections.facebookPages(), error: '', };
        } catch (e) {
            return { list: [] as FacebookPageOption[], error: (e as Error).message, };
        }
    },);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const choose = async (pageId: string,) => {
        if (!pageId) return;
        setSaving(true,);
        setError('',);
        try {
            const page = await cms.connections.selectFacebookPage(pageId,);
            props.onSaved?.(`Facebook Page set to ${page.name}.`,);
            await refetch();
        } catch (e) {
            setError((e as Error).message,);
        } finally {
            setSaving(false,);
        }
    };

    const selected = () => pages()?.list.find((p,) => p.selected);

    return (
        <FormField
            label="Page"
            hint="The Page whose followers, posts and insights are collected. Its Page token is saved for you."
        >
            <Show
                when={pages()?.list.length}
                fallback={
                    <div class="form-help-muted">
                        {pages.loading
                            ? 'Loading Pages…'
                            : pages()?.error || 'This token manages no Pages (a Page token is used as is).'}
                    </div>
                }
            >
                <select
                    value={selected()?.id ?? ''}
                    disabled={saving()}
                    onChange={(e,) => void choose(e.currentTarget.value,)}
                >
                    <Show when={!selected()}>
                        <option value="">Choose a Page…</option>
                    </Show>
                    <For each={pages()?.list}>
                        {(p,) => (
                            <option value={p.id}>
                                {p.name}{p.category ? ` — ${p.category}` : ''}{p.canAnalyze ? '' : ' (no insights access)'}
                            </option>
                        )}
                    </For>
                </select>
                <Show when={selected() && !selected()!.canAnalyze}>
                    <div class="form-help-muted">
                        You do not have the ANALYZE task on this Page, so only basic data is collected (followers, posts with reactions, comments and shares).
                    </div>
                </Show>
            </Show>
            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>
        </FormField>
    );
};

export default FacebookPagePicker;
