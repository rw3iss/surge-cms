/**
 * Common ISO 4217 currencies for the site "Default Currency" picker.
 *
 * Deliberately a short curated list, not all ~180 codes: this drives a
 * settings dropdown, and a wall of obscure codes makes the common choice
 * harder to find. Extend when an operator actually needs one.
 */
export interface CurrencyOption {
    code: string;
    label: string;
    symbol: string;
}

export const CURRENCIES: CurrencyOption[] = [
    { code: 'USD', label: 'US Dollar', symbol: '$', },
    { code: 'EUR', label: 'Euro', symbol: '€', },
    { code: 'GBP', label: 'British Pound', symbol: '£', },
    { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$', },
    { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', },
    { code: 'NZD', label: 'New Zealand Dollar', symbol: 'NZ$', },
    { code: 'JPY', label: 'Japanese Yen', symbol: '¥', },
    { code: 'CHF', label: 'Swiss Franc', symbol: 'CHF', },
    { code: 'SEK', label: 'Swedish Krona', symbol: 'kr', },
    { code: 'NOK', label: 'Norwegian Krone', symbol: 'kr', },
    { code: 'DKK', label: 'Danish Krone', symbol: 'kr', },
    { code: 'MXN', label: 'Mexican Peso', symbol: 'MX$', },
    { code: 'BRL', label: 'Brazilian Real', symbol: 'R$', },
    { code: 'INR', label: 'Indian Rupee', symbol: '₹', },
    { code: 'ZAR', label: 'South African Rand', symbol: 'R', },
];

const BY_CODE = new Map(CURRENCIES.map((c,) => [c.code, c,]),);

/** Symbol for a code, falling back to the code itself so an unknown currency
 *  still renders something meaningful rather than blank. */
export function currencySymbol(code: string | null | undefined,): string {
    if (!code) return '$';
    return BY_CODE.get(code.toUpperCase(),)?.symbol ?? code.toUpperCase();
}
