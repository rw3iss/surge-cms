import { beforeEach, describe, expect, it, vi, } from 'vitest';

const cfg = { email: { from: 'Surge Media <noreply@mail.surgemedia.us>', }, };
vi.mock('../../config', () => ({ config: cfg, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);
const get = vi.fn();
let failRead = false;
vi.mock('../settings', () => ({
    get: async (...a: unknown[]) => {
        if (failRead) throw new Error('db down',);
        return get(...a,);
    },
}),);

const { parseAddress, resolveSender, } = await import('./sender');

beforeEach(() => {
    get.mockReset();
    failRead = false;
},);

describe('parseAddress', () => {
    it('splits Name <address>', () => {
        expect(parseAddress('Surge Media <a@b.co>',),).toEqual({ name: 'Surge Media', email: 'a@b.co', },);
        expect(parseAddress('"Quoted, Name" <a@b.co>',),).toEqual({ name: 'Quoted, Name', email: 'a@b.co', },);
    });
    it('takes a bare address', () => expect(parseAddress('a@b.co',),).toEqual({ email: 'a@b.co', },));
    it('handles empty', () => expect(parseAddress(undefined,),).toEqual({},));
});

describe('resolveSender', () => {
    it('falls back to EMAIL_FROM when nothing is set', async () => {
        get.mockResolvedValue(null,);
        expect(await resolveSender(),).toEqual({ fromName: 'Surge Media', fromEmail: 'noreply@mail.surgemedia.us', },);
    });
    it('site default beats EMAIL_FROM', async () => {
        get.mockResolvedValue({ fromName: 'Site', fromAddress: 'site@x.co', },);
        expect(await resolveSender(),).toEqual({ fromName: 'Site', fromEmail: 'site@x.co', },);
    });
    it('a feature override beats both, field by field', async () => {
        get.mockResolvedValue({ fromName: 'Site', fromAddress: 'site@x.co', },);
        expect(await resolveSender({ fromName: 'Events', },),).toEqual({
            fromName: 'Events',
            fromEmail: 'site@x.co',
        },);
    });
    it('blank strings mean "not set"', async () => {
        get.mockResolvedValue({ fromName: '  ', fromAddress: '', },);
        expect((await resolveSender({ fromEmail: ' ', },)).fromEmail,).toBe('noreply@mail.surgemedia.us',);
    });
    it('a failed settings read still sends', async () => {
        failRead = true;
        expect((await resolveSender()).fromEmail,).toBe('noreply@mail.surgemedia.us',);
    });
});
