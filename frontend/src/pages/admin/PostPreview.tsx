import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createMemo, For, Show, } from 'solid-js';
import PreviewOverlay from '../../components/admin/common/PreviewOverlay';
import { Layout, } from '../../components/layout/Layout';
import PostContentBlock from '../../components/blocks/posts/PostContentBlock';

const PostPreview: Component = () => {
    const params = useParams();
    const navigate = useNavigate();

    const previewData = createMemo(() => {
        const raw = sessionStorage.getItem(`preview:post:${params.id}`,);
        if (!raw) {
            navigate(`/admin/posts/${params.id}`,);
            return null;
        }
        try {
            return JSON.parse(raw,);
        } catch {
            navigate(`/admin/posts/${params.id}`,);
            return null;
        }
    },);

    return (
        <Show when={previewData()}>
            {(data,) => (
                <PreviewOverlay backUrl={`/admin/posts/${params.id}`}>
                    {/* Render the post inside the real public <Layout>
                        so the preview shows configured header, footer,
                        navigation, swatches, fonts, and appearance. */}
                    <Layout>
                        <div class="post-page page-wrapper">
                        <article style={{ 'max-width': '800px', margin: '0 auto', padding: '2rem 1rem', }}>
                            <h1 style={{ 'margin-bottom': '0.5rem', }}>{data().title || 'Untitled Post'}</h1>
                            <div style={{ color: '#999', 'margin-bottom': '2rem', 'font-size': '0.9rem', }}>
                                {data().status === 'draft' ? 'Draft' : 'Preview'}
                                {data().excerpt ? ` — ${data().excerpt}` : ''}
                            </div>
                            <Show when={data().blocks?.length}>
                                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem', }}>
                                    <For each={data().blocks}>
                                        {(block: any,) => <PostContentBlock block={block} />}
                                    </For>
                                </div>
                            </Show>
                            <Show when={!data().blocks?.length}>
                                <div style={{ padding: '2rem', 'text-align': 'center', color: '#999', }}>
                                    No content blocks to preview
                                </div>
                            </Show>
                        </article>
                        </div>
                    </Layout>
                </PreviewOverlay>
            )}
        </Show>
    );
};

export default PostPreview;
