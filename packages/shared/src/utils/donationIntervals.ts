/**
 * How often a recurring donation repeats. ONE definition shared by the donate
 * form, the API validation and the Stripe mapping, so a period offered in the
 * form always exists in Stripe's terms.
 */
export type DonationInterval = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export const DONATION_INTERVALS: ReadonlyArray<{
    value: DonationInterval;
    label: string;
    /** Stripe's recurring interval + count. */
    stripe: { interval: 'week' | 'month' | 'year'; intervalCount: number; };
}> = [
    { value: 'weekly', label: 'Weekly', stripe: { interval: 'week', intervalCount: 1, }, },
    { value: 'monthly', label: 'Monthly', stripe: { interval: 'month', intervalCount: 1, }, },
    { value: 'quarterly', label: 'Every 3 months', stripe: { interval: 'month', intervalCount: 3, }, },
    { value: 'semiannual', label: 'Every 6 months', stripe: { interval: 'month', intervalCount: 6, }, },
    { value: 'yearly', label: 'Yearly', stripe: { interval: 'year', intervalCount: 1, }, },
];

export const DEFAULT_DONATION_INTERVAL: DonationInterval = 'monthly';

export function donationInterval(v: string | null | undefined,) {
    return DONATION_INTERVALS.find((i,) => i.value === v,);
}
