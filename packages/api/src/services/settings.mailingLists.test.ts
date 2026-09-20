/**
 * Mailing-list sender defaults.
 *
 * The getter normalises what the form stores. Blank is the operator CLEARING a
 * field, and it must come back as `undefined` rather than `''` — the send
 * worker chains with `??`, and an empty string is not nullish, so a cleared
 * field would win over every fallback and mail would go out with no From name
 * or, worse, an empty From address.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => queryMock(...a,), }),);
vi.mock('./cache', () => ({
    cache: {
        get: vi.fn().mockResolvedValue(null,),
        set: vi.fn(),
        invalidateSettingsCache: vi.fn(),
    },
}),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('../config', () => ({ config: { shopify: {}, email: {}, mail: {}, }, }),);
vi.mock('./payment/credentials', () => ({ stripeCredentials: () => ({}), }),);

import { getMailingListsSettings, } from './settings';

/** The stored `mailing_lists_settings` row, or none. */
function stored(value: unknown,) {
    queryMock.mockResolvedValue(value === undefined ? { rows: [], } : { rows: [{ value, },], },);
}

beforeEach(() => queryMock.mockReset(),);

describe('getMailingListsSettings', () => {
    it('returns the configured values', async () => {
        stored({
            defaultFromName: 'Frank Scales, Surge Media',
            defaultFromEmail: 'newsletter@lists.surgemedia.us',
            defaultReplyTo: 'hello@surgemedia.us',
        },);
        expect(await getMailingListsSettings(),).toEqual({
            defaultFromName: 'Frank Scales, Surge Media',
            defaultFromEmail: 'newsletter@lists.surgemedia.us',
            defaultReplyTo: 'hello@surgemedia.us',
        },);
    },);

    it('turns a CLEARED field into undefined, not an empty string', async () => {
        // THE BUG THIS PREVENTS. The worker chains `job.fromEmail ??
        // defaults.defaultFromEmail ?? config…`. `''` is not nullish, so a
        // cleared field would short-circuit the chain and send from "".
        stored({ defaultFromName: '', defaultFromEmail: '   ', defaultReplyTo: '', },);
        const s = await getMailingListsSettings();
        expect(s.defaultFromName,).toBeUndefined();
        expect(s.defaultFromEmail,).toBeUndefined();
        expect(s.defaultReplyTo,).toBeUndefined();
    },);

    it('returns all-undefined when nothing is configured', async () => {
        // A fresh install must behave exactly as before this feature existed.
        stored(undefined,);
        expect(await getMailingListsSettings(),).toEqual({
            defaultFromName: undefined,
            defaultFromEmail: undefined,
            defaultReplyTo: undefined,
        },);
    },);

    it('trims surrounding whitespace', async () => {
        stored({ defaultFromEmail: '  news@lists.example.com  ', },);
        expect((await getMailingListsSettings()).defaultFromEmail,)
            .toBe('news@lists.example.com',);
    },);

    it('tolerates a partially-filled row', async () => {
        stored({ defaultFromName: 'Surge Media', },);
        const s = await getMailingListsSettings();
        expect(s.defaultFromName,).toBe('Surge Media',);
        expect(s.defaultFromEmail,).toBeUndefined();
    },);
},);
