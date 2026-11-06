import { beforeEach, describe, expect, it, vi, } from 'vitest';

const repo = vi.hoisted(() => ({
    withSystemPageLock: vi.fn(),
    releaseSystemPage: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    findPageById: vi.fn(),
}));
vi.mock('../repositories/pages.repo', () => repo,);
vi.mock('./cache', () => ({
    cache: { invalidatePageCache: vi.fn(), invalidateSettingsCache: vi.fn(), },
}));
vi.mock('./audit', () => ({ logAudit: vi.fn(), }));
vi.mock('./revisions', () => ({ markDirty: vi.fn(), }));

import { create, resolveSystemPageClaim, update, } from './pages';

const ctx = { userId: 'u1', } as never;
const TX = (() => {}) as never;

beforeEach(() => {
    vi.clearAllMocks();
    repo.withSystemPageLock.mockImplementation(async (_key: string, fn: (run: unknown,) => unknown,) => fn(TX,),);
    repo.releaseSystemPage.mockResolvedValue({ id: 'old', title: 'Old home', },);
    repo.createPage.mockImplementation(async (data: Record<string, unknown>,) => ({ id: 'new', ...data, }));
    repo.updatePage.mockImplementation(async (id: string, data: Record<string, unknown>,) => ({ id, ...data, }));
},);

describe('resolveSystemPageClaim', () => {
    it('leaves the assignment alone when the write does not mention it', () => {
        const d: Record<string, unknown> = { title: 'x', };
        expect(resolveSystemPageClaim(d, 'home',),).toBeUndefined();
        expect('systemPage' in d,).toBe(false,);
    },);
    it('claims a new key and mirrors is_homepage', () => {
        const d: Record<string, unknown> = { systemPage: 'home', };
        expect(resolveSystemPageClaim(d, null,),).toBe('home',);
        expect(d,).toEqual({ systemPage: 'home', isHomepage: true, },);
    },);
    it('claims nothing when the page already holds the key or clears it', () => {
        expect(resolveSystemPageClaim({ systemPage: 'shop', }, 'shop',),).toBeNull();
        const d: Record<string, unknown> = { systemPage: '', };
        expect(resolveSystemPageClaim(d, 'shop',),).toBeNull();
        expect(d,).toEqual({ systemPage: null, isHomepage: false, },);
    },);
    it('maps the legacy isHomepage flag', () => {
        expect(resolveSystemPageClaim({ isHomepage: true, }, null,),).toBe('home',);
        const off: Record<string, unknown> = { isHomepage: false, };
        expect(resolveSystemPageClaim(off, 'home',),).toBeNull();
        expect(off.systemPage,).toBeNull();
        // isHomepage:false on a page that is the Shop page keeps the Shop key.
        const shop: Record<string, unknown> = { isHomepage: false, };
        expect(resolveSystemPageClaim(shop, 'shop',),).toBeNull();
        expect(shop.systemPage,).toBe('shop',);
    },);
},);

describe('claiming a system page', () => {
    it('releases + writes inside ONE locked transaction', async () => {
        const page = await create({ title: 'Home', slug: 'home', systemPage: 'home', }, ctx,);
        expect(repo.withSystemPageLock,).toHaveBeenCalledWith('home', expect.any(Function,),);
        expect(repo.releaseSystemPage,).toHaveBeenCalledWith('home', null, TX,);
        expect(repo.createPage,).toHaveBeenCalledWith(expect.anything(), 'u1', TX,);
        expect(page.systemPageReplaced,).toEqual({ id: 'old', title: 'Old home', },);
    },);
    it('a write that fails after the release rejects (the transaction rolls the release back)', async () => {
        repo.findPageById.mockResolvedValue({ id: 'p1', systemPage: null, },);
        repo.updatePage.mockRejectedValueOnce(Object.assign(new Error('dup slug',), { code: '23505', },),);
        await expect(update('p1', { systemPage: 'home', slug: 'taken', }, ctx,),).rejects.toThrow('dup slug',);
        expect(repo.withSystemPageLock,).toHaveBeenCalledTimes(1,);
    },);
    it('takes no lock when the key does not change', async () => {
        repo.findPageById.mockResolvedValue({ id: 'p1', systemPage: 'home', },);
        const page = await update('p1', { systemPage: 'home', title: 'x', }, ctx,);
        expect(repo.withSystemPageLock,).not.toHaveBeenCalled();
        expect(repo.updatePage,).toHaveBeenCalledWith('p1', expect.anything(), undefined,);
        expect(page.systemPageReplaced,).toBeNull();
    },);
},);
