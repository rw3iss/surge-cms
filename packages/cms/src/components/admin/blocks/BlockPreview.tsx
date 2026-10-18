import { Component, createComputed, onCleanup, onMount, Show, Suspense, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { BlockRenderer, } from '../../blocks/BlockRenderer';
import { BlockStyleService, } from '../../../services/blockStyles';
import { styleDraft, } from '../../../stores/blockStyleDraft';
import { templatePreviewContext, } from '../../../stores/templatePreviewContext';
import type { BlockData, } from './ContentBlock';
import { isBlockConfigured, } from '../../../config/blockTypes';

/** Fixed timestamps: a new Date per render would change the block for nothing. */
const PREVIEW_EPOCH = new Date(0,);

/** Deep plain copy of JSON-shaped block data (reads through store proxies). */
function plainCopy<T,>(v: T,): T {
    return v == null ? v : JSON.parse(JSON.stringify(v,),) as T;
}

interface BlockPreviewProps {
    block: BlockData;
}

/**
 * Renders admin BlockData using the public BlockRenderer so the admin
 * preview looks identical to the live site. Resolves style template
 * references to actual style objects.
 */
const BlockPreview: Component<BlockPreviewProps> = (props,) => {
    let guardRef: HTMLDivElement | undefined;

    // While authoring, neutralize clicks that originate inside the rendered
    // preview content. A Custom HTML block (or any block) may contain links,
    // buttons, or forms that would otherwise navigate, open a new tab, submit,
    // or run inline handlers when the operator clicks the preview. Handling
    // this in the capture phase + stopPropagation also keeps the click from
    // reaching the block's select/toggle handler, so a block is selected via
    // its hover bar instead. The empty-state placeholder is exempted so a
    // brand-new block can still be selected by clicking it.
    const silenceContentClick = (e: MouseEvent,) => {
        if ((e.target as HTMLElement).closest('.block-preview__empty',)) return;
        e.preventDefault();
        e.stopPropagation();
    };
    onMount(() => guardRef?.addEventListener('click', silenceContentClick, true,));
    onCleanup(() => guardRef?.removeEventListener('click', silenceContentClick, true,));

    const buildBlock = () => {
        // A deep, PLAIN copy: JSON round-trip reads every nested key through
        // the editor's store proxy (so this tracks any data edit) and hands the
        // local store objects of its own — never nodes shared with the editor.
        const { title, content, __styleRef: _drop, ...rest } = plainCopy(props.block.data,) ?? {};

        // Resolve style from styleRef or data.__styleRef (shared resolver).
        // An in-progress edit from the style panel WINS, so the preview tracks
        // the controls live; the panel clears the draft on Save (the value is
        // on the block by then) and on Cancel (which makes falling back to the
        // saved style the revert).
        const resolvedStyle = plainCopy(styleDraft(props.block.id,) ?? BlockStyleService.resolve(props.block,),);

        // The preview breakpoint is NOT simulated here any more.
        //
        // This used to merge the breakpoint's overrides over the base style, so
        // the emitted "default" carried mobile values. That worked only for the
        // block this component renders directly — a component's inner blocks, an
        // entity slide and anything else reached through BlockRenderer got the
        // real `@media` rules, which cannot fire in a width-capped preview. They
        // kept showing desktop styles.
        //
        // `blockCss` now emits every breakpoint a second time as a `@container`
        // query, and the preview container declares that container name, so the
        // override reaches EVERY block inside it — no simulation, and one
        // mechanism instead of two that can disagree.
        const effectiveStyle = resolvedStyle;

        return {
            id: props.block.id,
            pageId: '',
            type: props.block.type,
            title: title || null,
            content: content || null,
            settings: rest,
            order: props.block.sort_order || 0,
            isVisible: true,
            style: effectiveStyle,
            createdAt: PREVIEW_EPOCH,
            updatedAt: PREVIEW_EPOCH,
        };
    };

    // The block handed to BlockRenderer is a STORE, reconciled in place.
    //
    // It used to be a fresh object literal on every read. Every renderer that
    // keys a resource on its settings (Gallery, Social, Posts, Campaign, …)
    // then saw a NEW source on any change to the block — a style draft
    // included — and refetched. A refetch read under the admin's app-level
    // <Suspense> swapped the whole admin for the loading fallback: the
    // document collapsed and the editor jumped to the top. Reconciled, a
    // style change only touches `style.*`, so a settings-keyed resource is
    // not re-run at all, and nothing is re-created that did not change.
    const [rendered, setRendered,] = createStore(buildBlock(),);
    createComputed(() => setRendered(reconcile(buildBlock(), { merge: true, },),),);

    // One arm per block type in config/blockTypes.ts (`BLOCK_CONFIGURED`).
    const isEmpty = () => !isBlockConfigured(props.block.type, props.block.data,);

    return (
        <div ref={guardRef} style={{ display: 'contents', }}>
            <Show
                when={!isEmpty()}
                fallback={
                    <div class="block-preview__empty">
                        <span class="block-preview__empty-label">
                            {props.block.type.replace(/_/g, ' ',)}
                        </span>
                        <span class="block-preview__empty-hint">Click edit to configure</span>
                    </div>
                }
            >
                {/* Local boundary: a block whose renderer legitimately refetches
                    (its query was edited) suspends only itself — never the
                    app-level <Suspense>, which would blank the admin and
                    throw the editor back to the top. */}
                <Suspense>
                    <BlockRenderer block={rendered as any} preview={true} templateContext={templatePreviewContext()} />
                </Suspense>
            </Show>
        </div>
    );
};

export default BlockPreview;
