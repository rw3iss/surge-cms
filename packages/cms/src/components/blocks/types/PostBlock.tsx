/**
 * Single embedded post.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, Post, } from '@sitesurge/types';
import { Component, Show, createResource, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import TemplatedContent from '../TemplatedContent';
import { type TplCtx, } from './shared';

export const PostBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const postId = () => props.block.settings.postId as string;

    const [post,] = createResource(postId, async (id,) => {
        if (!id) return null;
        try {
            return await cms.posts.getById(id,) as Post;
        } catch {
            return null;
        }
    },);

    // Inside a post embed, `{{post.*}}` refers to the embedded post.
    const ctx = (): TplCtx => ({
        ...props.ctx,
        post: { kind: 'post', data: post() as unknown as Record<string, unknown>, id: post()?.id },
    });

    return (
        <Show when={post()}>
            <article class="post-block">
                <Show when={post()!.featuredImage}>
                    <img src={post()!.featuredImage} alt={post()!.title} class="post-block__image" />
                </Show>
                <h2 class="post-block__title">{post()!.title}</h2>
                <TemplatedContent class="rich-text" html={post()!.content} entities={ctx()} />
            </article>
        </Show>
    );
};
