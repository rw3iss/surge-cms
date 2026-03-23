import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createMemo, For, Show, } from 'solid-js';
import PreviewOverlay from '../../components/admin/PreviewOverlay';
import { BlockRenderer, } from '../../components/BlockRenderer/BlockRenderer';
import { Header, } from '../../components/Layout/Header';

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

    return (
        <Show when={previewData()}>
            {(data,) => (
                <PreviewOverlay backUrl={`/admin/pages/${params.id}`}>
                    <Header
                        navigation={[]}
                        siteName="Surge Media"
                    />
                    <main style={{ 'min-height': '70vh', }}>
                        <For each={data().blocks || []}>
                            {(block: any,) => {
                                // Convert from edit format to render format
                                const renderBlock = {
                                    id: block.id,
                                    pageId: params.id,
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
                                };
                                return <BlockRenderer block={renderBlock as any} />;
                            }}
                        </For>
                        <Show when={!previewData()?.blocks?.length}>
                            <div style={{ padding: '4rem 2rem', 'text-align': 'center', color: '#999', }}>
                                No content blocks to preview
                            </div>
                        </Show>
                    </main>
                </PreviewOverlay>
            )}
        </Show>
    );
};

export default PagePreview;
