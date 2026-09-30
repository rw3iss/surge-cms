import { describe, expect, it, } from 'vitest';
import { entityRef, renderTemplateToString, resolveValueFunction, UNRESOLVED, } from './index';
import type { TemplateRuntime, } from './types';

const POST = {
    title: 'Hello',
    featuredImage: 'https://cdn.example/uploads/a.jpg',
    featuredMedia: {
        id: 'm1', path: 'https://cdn.example/uploads/a.jpg', url: 'https://cdn.example/uploads/a.jpg',
        title: 'Rally', description: 'Crowd at City Hall', credits: 'Photo: J. Doe', alt: 'Crowd', thumbnailUrl: null, mimeType: 'image/jpeg',
    },
};

const rt = (context: Record<string, unknown>,): TemplateRuntime => ({
    context,
    // Like the real runtimes: value functions first, nothing else resolvable.
    resolve: async (name: string, args: unknown[],) => {
        const v = resolveValueFunction(name, args,);
        return v === UNRESOLVED ? undefined : v;
    },
});
const render = (src: string, context: Record<string, unknown>,) =>
    renderTemplateToString(src, rt(context,), () => '',);

describe('media values in templates', () => {
    const ctx = { post: entityRef('post', POST,), };

    it('featuredImage alone still prints the path', async () => {
        expect(await render('<img src="{{post.featuredImage}}">', ctx,),).toBe('<img src="https://cdn.example/uploads/a.jpg">',);
    },);

    it('exposes the media item properties', async () => {
        expect(await render('{{post.featuredImage.credits}}', ctx,),).toBe('Photo: J. Doe',);
        expect(await render('{{post.featuredImage.title}} / {{post.featuredImage.description}}', ctx,),)
            .toBe('Rally / Crowd at City Hall',);
        expect(await render('{{post.featuredImage.path}}', ctx,),).toBe('https://cdn.example/uploads/a.jpg',);
    },);

    it('works for a URL with no library record', async () => {
        const c = { post: entityRef('post', { featuredImage: '/x.png', },), };
        expect(await render('{{post.featuredImage.path}}|{{post.featuredImage.credits}}', c,),).toBe('/x.png|',);
    },);

    it('is usable in conditions and value functions', async () => {
        expect(await render('{{if post.featuredImage.credits}}yes{{endif}}', ctx,),).toBe('yes',);
        expect(await render('{{upper(post.featuredImage.credits)}}', ctx,),).toBe('PHOTO: J. DOE',);
        expect(await render('{{default(post.featuredImage, "none")}}', ctx,),).toBe('https://cdn.example/uploads/a.jpg',);
    },);

    it('no image → empty and falsy', async () => {
        const c = { post: entityRef('post', { featuredImage: '', featuredMedia: null, },), };
        expect(await render('{{if post.featuredImage}}img{{else}}none{{endif}}', c,),).toBe('none',);
    },);
},);
