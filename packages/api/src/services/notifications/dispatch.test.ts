import { beforeEach, describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    inAppEnabled: true,
    created: [] as unknown[],
    pushed: [] as unknown[],
    emailed: [] as unknown[],
}),);
vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [{ value: h.settings, },], }),), }),);
vi.mock('./options', () => ({ getNotificationOptions: async () => ({ inAppEnabled: h.inAppEnabled, retentionDays: 90, }), }),);
vi.mock('./inApp', () => ({
    recipientsFor: async (cfg: { userIds: string[]; },) => cfg.userIds,
    createFor: async (ids: string[], m: unknown,) => { h.created.push({ ids, m, },); return ids.length; },
}),);
vi.mock('./push', () => ({ sendTo: async (ids: string[], p: unknown,) => { h.pushed.push({ ids, p, },); return ids.length; }, }),);
vi.mock('./channels', async (orig,) => ({
    ...(await orig<typeof import('./channels')>()),
    CHANNELS: { email: { id: 'email', send: async (a: string[],) => { h.emailed.push(a,); }, }, sms: { id: 'sms', send: async () => undefined, }, },
}),);

import { hasRecipients, invalidateNotificationSettings, notify, } from './index';

const msg = { subject: 'New post up for review: X', text: 'Ann submitted X.', url: '/admin/posts/1', };

describe('notify()', () => {
    beforeEach(() => {
        h.created = []; h.pushed = []; h.emailed = []; h.inAppEnabled = true;
        invalidateNotificationSettings();
    },);

    it('creates in-app rows for the recipients and pushes when desktop is on', async () => {
        h.settings = { post_submitted: { inApp: { enabled: true, userIds: ['u1', 'u2',], roles: [], }, push: { enabled: true, }, }, };
        await notify('post_submitted', msg,);
        expect(h.created,).toEqual([{ ids: ['u1', 'u2',], m: { type: 'post_submitted', title: msg.subject, body: msg.text, url: msg.url, }, },],);
        expect((h.pushed[0] as { ids: string[]; }).ids,).toEqual(['u1', 'u2',],);
    },);

    it('skips in-app when the global switch is off, still emails', async () => {
        h.inAppEnabled = false;
        h.settings = { post_submitted: { email: { enabled: true, addresses: ['a@x.co',], }, inApp: { enabled: true, userIds: ['u1',], roles: [], }, }, };
        await notify('post_submitted', msg,);
        expect(h.created,).toEqual([],);
        expect(h.emailed,).toEqual([['a@x.co',],],);
    },);

    it('no desktop push without the push switch', async () => {
        h.settings = { post_submitted: { inApp: { enabled: true, userIds: ['u1',], roles: [], }, }, };
        await notify('post_submitted', msg,);
        expect(h.created.length,).toBe(1,);
        expect(h.pushed,).toEqual([],);
    },);

    it('hasRecipients counts in-app users / roles', async () => {
        h.settings = { t: { inApp: { enabled: true, userIds: [], roles: ['editor',], }, }, };
        expect(await hasRecipients('t',),).toBe(true,);
        invalidateNotificationSettings();
        h.settings = { t: { inApp: { enabled: true, userIds: [], roles: [], }, }, };
        expect(await hasRecipients('t',),).toBe(false,);
    },);
},);
