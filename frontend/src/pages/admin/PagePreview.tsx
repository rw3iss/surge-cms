import { useNavigate, useParams, } from '@solidjs/router';
import { buildBlockTree, } from '@rw/shared';
import { Component, createMemo, For, Show, } from 'solid-js';
import PreviewOverlay from '../../components/admin/common/PreviewOverlay';
import { BlockRenderer, } from '../../components/blocks/BlockRenderer';
import { Layout, } from '../../components/layout/Layout';

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
     *  with their children. */
    const tree = createMemo(() => {
        const blocks = (previewData()?.blocks || []) as any[];
        const flat = blocks.map((block,) => ({
            id: block.id,
            pageId: params.id,
            parentBlockId: block.parentBlockId ?? null,
            type: block.type,
            title: block.data?.title || null,
            content: block.data?.content || null,
            settings: (() => {
                const { title: _t, content: _c, __styleRef: _s, ...rest } = block.data || {};
                return rest;
            })(),
            order: block.sort_order || 0,
            isVisible: true,
            style: block.styleRef?.custom ||
                (block.styleRef?.templateId ? { id: block.styleRef.templateId, } : undefined),
            createdAt: new Date(),
            updatedAt: new Date(),
        }),) as any[];
        return buildBlockTree(flat,);
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
                                {(block,) => <BlockRenderer block={block as any} />}
                            </For>
                            <Show when={!data().blocks?.length}>
                                <div style={{ padding: '4rem 2rem', 'text-align': 'center', color: '#999', }}>
                                    No content blocks to preview
                                </div>
                            </Show>
                        </div>
                    </Layout>
                </PreviewOverlay>
            )}
        </Show>
    );
};

export default PagePreview;
