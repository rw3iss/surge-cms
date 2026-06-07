import { useNavigate, useParams, } from '@solidjs/router';
import { buildBlockTree, } from '@rw/cms-shared';
import { Component, createMemo, For, Show, } from 'solid-js';
import PreviewOverlay from '../../components/admin/common/PreviewOverlay';
import { BlockRenderer, } from '../../components/blocks/BlockRenderer';
import { Layout, } from '../../components/layout/Layout';
import { blockDataToRenderBlock, } from '../../utils/blockData';

const PagePreview: Component = () => {
    const params = useParams();
    const navigate = useNavigate();

    const previewData = createMemo(() => {
        const raw = sessionStorage.getItem(`preview:page:${params.id}`,);
        if (!raw) {
            navigate(`/admin/pages/${params.id}`,);
            return null;
        }
        try {
            return JSON.parse(raw,);
        } catch {
            navigate(`/admin/pages/${params.id}`,);
            return null;
        }
    },);

    /** Convert the editor's BlockData shape to the public Block shape
     *  the renderer expects, then assemble a tree so groups render
     *  with their children. Uses the shared `blockDataToRenderBlock`
     *  helper so the transform stays in one place. */
    const tree = createMemo(() => {
        const blocks = (previewData()?.blocks || []) as any[];
        return buildBlockTree(blocks.map((b,) => blockDataToRenderBlock(b, params.id,)),);
    },);

    return (
        <Show when={previewData()}>
            {(data,) => (
                <PreviewOverlay backUrl={`/admin/pages/${params.id}`}>
                    {/* Use the same <Layout> the public site uses so the
                        preview shows the configured header, footer,
                        navigation, appearance vars, swatches, and fonts. */}
                    <Layout>
                        <div class="dynamic-page page-wrapper">
                            <Show when={data().title}>
                                <h1 class="dynamic-page__title" style={{ 'text-align': data().titleAlignment || 'left', }}>
                                    {data().title}
                                </h1>
                            </Show>
                            <For each={tree()}>
                                {(block,) => <BlockRenderer block={block} />}
                            </For>
                            <Show when={!data().blocks?.length}>
                                <div class="preview-empty-message">No content blocks to preview</div>
                            </Show>
                        </div>
                    </Layout>
                </PreviewOverlay>
            )}
        </Show>
    );
};

export default PagePreview;
