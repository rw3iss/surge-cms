import { beforeEach, describe, expect, it, vi, } from 'vitest';

let stored: unknown = {};
vi.mock('./settings', () => ({
    getPostsSettingsRaw: async () => stored,
    setPostsSettingsRaw: async (v: unknown,) => { stored = v; },
}),);

import { getForClient, getPostsSettings, SECRET_MASK, update, } from './postSettings';

const ctx = { userId: 'u', } as never;

beforeEach(() => { stored = {}; },);

describe('posts settings', () => {
    it('defaults: article, no provider', async () => {
        const s = await getPostsSettings();
        expect(s.general.defaultPostType,).toBe('article',);
        expect(s.live.provider,).toBeNull();
    },);

    it('masks secrets on read and keeps them when the mask is echoed back', async () => {
        await update({ live: { provider: '100ms', providers: { '100ms': { accessKey: 'ak', appSecret: 'shh', templateId: 't', }, }, }, }, ctx,);
        const shown = await getForClient();
        expect(shown.settings.live.providers['100ms'].appSecret,).toBe(SECRET_MASK,);
        await update({ live: { providers: { '100ms': { ...shown.settings.live.providers['100ms'], templateId: 't2', }, }, }, }, ctx,);
        const real = await getPostsSettings();
        expect(real.live.providers['100ms'],).toMatchObject({ appSecret: 'shh', templateId: 't2', },);
        expect(real.live.provider,).toBe('100ms',);
    },);

    it('drops unknown fields and rejects unknown providers / post types', async () => {
        await update({ live: { providers: { '100ms': { evil: 'x', accessKey: ' k ', }, }, }, }, ctx,);
        expect((await getPostsSettings()).live.providers['100ms'],).toEqual({ accessKey: 'k', },);
        await expect(update({ live: { provider: 'nope', providers: {}, }, }, ctx,),).rejects.toThrow(/Unknown live provider/,);
        await expect(update({ general: { defaultPostType: 'nope', }, }, ctx,),).rejects.toThrow(/Unknown post type/,);
    },);
},);
