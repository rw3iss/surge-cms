import { describe, expect, it, vi, } from 'vitest';

// The component module pulls in the SDK and form components; only the pure
// helper is under test.
vi.mock('../../hooks/usePluginGate', () => ({ usePluginEnabled: () => () => false, }),);
vi.mock('../forms/donations/DonationForm', () => ({ default: () => null, }),);
vi.mock('./GiveButterWidget', () => ({ default: () => null, }),);
vi.mock('./TemplatedContent', () => ({ default: () => null, }),);
vi.mock('../../pages/Campaign.scss', () => ({}),);

const { optInField, } = await import('./CampaignForm');

describe('campaignForm text fields are opt-in', () => {
    it('hidden unless asked for', () => expect(optInField(undefined, 'Title',),).toBeNull());
    it('true shows the campaign value', () => expect(optInField(true, 'Title',),).toBe('Title',));
    it('a string overrides', () => expect(optInField('Give now', 'Title',),).toBe('Give now',));
    it('false stays hidden', () => expect(optInField(false, 'Title',),).toBeNull());
});
