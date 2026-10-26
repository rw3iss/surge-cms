import { beforeEach, describe, expect, it, vi, } from 'vitest';

const perms = vi.hoisted(() => ({ mode: 'approval' as 'allow' | 'approval' | 'deny', scope: 'own' as 'any' | 'own' | null, }),);
const author = vi.hoisted(() => ({ id: 'u1' as string | null, }),);
vi.mock('./permissions', () => ({
    checkMode: vi.fn(async () => perms.mode,),
    scopeFor: vi.fn(async () => perms.scope,),
}),);
vi.mock('../db', () => ({
    query: vi.fn(async () => ({ rows: author.id === null ? [] : [{ author_id: author.id, },], }),),
}),);

import { postAccess, shapeOwnPostWrite, } from './postAccess';

const contributor = { id: 'u1', role: 'member', };

describe('postAccess', () => {
    beforeEach(() => { perms.scope = 'own'; author.id = 'u1'; },);
    it('staff and API keys keep full access', async () => {
        expect(await postAccess({ id: 'x', role: 'editor', }, 'write', 'p1',),).toBe('any',);
        expect(await postAccess(undefined, 'write', 'p1', { name: 'k', },),).toBe('any',);
    },);
    it('own scope reaches only the posts they wrote', async () => {
        expect(await postAccess(contributor, 'read', 'p1',),).toBe('own',);
        author.id = 'someone-else';
        await expect(postAccess(contributor, 'read', 'p1',),).rejects.toThrow(/not found/i,);
    },);
    it('no permission → forbidden; signed out → unauthorized', async () => {
        perms.scope = null;
        await expect(postAccess(contributor, 'write',),).rejects.toThrow(/permission/i,);
        await expect(postAccess(undefined, 'write',),).rejects.toThrow(/sign in/i,);
    },);
},);

describe('shapeOwnPostWrite', () => {
    beforeEach(() => { perms.mode = 'approval'; },);
    it('publish with approval → pending_review; author forced; gating stripped', async () => {
        const r = await shapeOwnPostWrite(contributor, { status: 'published', authorId: 'boss', requiredTierId: 't', gateHidden: true, }, null,);
        expect(r.body.status,).toBe('pending_review',);
        expect(r.body.authorId,).toBe('u1',);
        expect(r.body.requiredTierId,).toBeUndefined();
        expect(r.body.gateHidden,).toBeUndefined();
        expect(r.submitted,).toBe(true,);
    },);
    it('re-saving a pending post does not re-submit', async () => {
        const r = await shapeOwnPostWrite(contributor, { status: 'pending_review', }, { status: 'pending_review', },);
        expect(r.submitted,).toBe(false,);
    },);
    it('a plain allow publishes; a deny stays draft', async () => {
        perms.mode = 'allow';
        expect((await shapeOwnPostWrite(contributor, { status: 'published', }, null,)).body.status,).toBe('published',);
        perms.mode = 'deny';
        expect((await shapeOwnPostWrite(contributor, { status: 'published', }, null,)).body.status,).toBe('draft',);
    },);
    it('refuses editing a published post and live shows', async () => {
        await expect(shapeOwnPostWrite(contributor, { title: 'x', }, { status: 'published', },),).rejects.toThrow(/published/i,);
        await expect(shapeOwnPostWrite(contributor, { postType: 'live', }, null,),).rejects.toThrow(/live/i,);
    },);
},);

describe('shapeStatus (any scope)', () => {
    it('approval mode still holds for a writer with full scope', async () => {
        perms.mode = 'approval';
        const { shapeStatus, } = await import('./postAccess');
        const r = await shapeStatus({ id: 'u2', role: 'member', }, { status: 'published', title: 'x', }, null,);
        expect(r.body.status,).toBe('pending_review',);
        expect(r.submitted,).toBe(true,);
    },);
    it('allow leaves the status alone', async () => {
        perms.mode = 'allow';
        const { shapeStatus, } = await import('./postAccess');
        expect((await shapeStatus({ id: 'e', role: 'editor', }, { status: 'published', }, { status: 'draft', },)).body.status,).toBe('published',);
    },);
},);
