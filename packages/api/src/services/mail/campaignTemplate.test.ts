/**
 * {{campaignStatus()}} / {{campaignForm()}} in an email: the two halves of
 * {{campaign()}} flatten to what an inbox can show.
 */
import { describe, expect, it, vi, } from 'vitest';

const CAMPAIGN = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'spring',
    title: 'Spring Drive',
    currentAmountCents: 12550,
    goalAmountCents: 50000,
    showRaisedAmount: true,
};
let campaign: Record<string, unknown> = CAMPAIGN;
vi.mock('../campaigns', () => ({
    getBySlug: async (s: string,) => (s === 'spring' ? campaign : null),
    getById: async () => null,
}),);
vi.mock('../posts', () => ({}),);
vi.mock('../forms', () => ({}),);
vi.mock('../media', () => ({}),);
vi.mock('../pages', () => ({}),);
vi.mock('../entities', () => ({ get: async () => null, }),);
vi.mock('../../entities/entityManager', () => ({}),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), }, }),);

const { resolveMailTemplate, } = await import('./templateRuntime');

describe('campaign halves in email', () => {
    it('campaignStatus renders the raised / goal figures', async () => {
        campaign = CAMPAIGN;
        const html = await resolveMailTemplate("{{campaignStatus('spring')}}", {},);
        expect(html,).toContain('$125.50 raised',);
        expect(html,).toContain('$500.00 goal',);
    });

    it('campaignStatus shows nothing when the campaign hides its amounts', async () => {
        campaign = { ...CAMPAIGN, showRaisedAmount: false, };
        expect(await resolveMailTemplate("{{campaignStatus('spring')}}", {},),).toBe('',);
    });

    it('campaignForm becomes a donate link', async () => {
        campaign = CAMPAIGN;
        const html = await resolveMailTemplate("{{campaignForm('spring')}}", {},);
        expect(html,).toContain('href="/campaigns/spring"',);
        expect(html,).toContain('Donate to Spring Drive',);
    });
});
