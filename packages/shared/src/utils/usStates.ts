/**
 * US states + DC + inhabited territories, for the "State" dropdown shown on
 * /profile (and the CRM contact) when the selected country is the United States.
 *
 * Values are the 2-letter USPS codes, which is what existing rows already hold
 * (`PA`, `CA`, `NJ`, …) — so switching the text input for a dropdown does NOT
 * invalidate stored data. A handful of legacy rows hold full names
 * (`Pennsylvania`); `normalizeUsState` maps those onto the code so they select
 * correctly instead of appearing unrecognised.
 *
 * Hand-maintained: ICU has no US-subdivision list, and this set changes about
 * once a century.
 */
export interface UsStateOption {
    /** USPS 2-letter code, e.g. `PA`. */
    value: string;
    /** Full name, e.g. `Pennsylvania`. */
    label: string;
}

export const US_STATES: UsStateOption[] = [
    { value: 'AL', label: 'Alabama', },
    { value: 'AK', label: 'Alaska', },
    { value: 'AZ', label: 'Arizona', },
    { value: 'AR', label: 'Arkansas', },
    { value: 'CA', label: 'California', },
    { value: 'CO', label: 'Colorado', },
    { value: 'CT', label: 'Connecticut', },
    { value: 'DE', label: 'Delaware', },
    { value: 'DC', label: 'District of Columbia', },
    { value: 'FL', label: 'Florida', },
    { value: 'GA', label: 'Georgia', },
    { value: 'HI', label: 'Hawaii', },
    { value: 'ID', label: 'Idaho', },
    { value: 'IL', label: 'Illinois', },
    { value: 'IN', label: 'Indiana', },
    { value: 'IA', label: 'Iowa', },
    { value: 'KS', label: 'Kansas', },
    { value: 'KY', label: 'Kentucky', },
    { value: 'LA', label: 'Louisiana', },
    { value: 'ME', label: 'Maine', },
    { value: 'MD', label: 'Maryland', },
    { value: 'MA', label: 'Massachusetts', },
    { value: 'MI', label: 'Michigan', },
    { value: 'MN', label: 'Minnesota', },
    { value: 'MS', label: 'Mississippi', },
    { value: 'MO', label: 'Missouri', },
    { value: 'MT', label: 'Montana', },
    { value: 'NE', label: 'Nebraska', },
    { value: 'NV', label: 'Nevada', },
    { value: 'NH', label: 'New Hampshire', },
    { value: 'NJ', label: 'New Jersey', },
    { value: 'NM', label: 'New Mexico', },
    { value: 'NY', label: 'New York', },
    { value: 'NC', label: 'North Carolina', },
    { value: 'ND', label: 'North Dakota', },
    { value: 'OH', label: 'Ohio', },
    { value: 'OK', label: 'Oklahoma', },
    { value: 'OR', label: 'Oregon', },
    { value: 'PA', label: 'Pennsylvania', },
    { value: 'RI', label: 'Rhode Island', },
    { value: 'SC', label: 'South Carolina', },
    { value: 'SD', label: 'South Dakota', },
    { value: 'TN', label: 'Tennessee', },
    { value: 'TX', label: 'Texas', },
    { value: 'UT', label: 'Utah', },
    { value: 'VT', label: 'Vermont', },
    { value: 'VA', label: 'Virginia', },
    { value: 'WA', label: 'Washington', },
    { value: 'WV', label: 'West Virginia', },
    { value: 'WI', label: 'Wisconsin', },
    { value: 'WY', label: 'Wyoming', },
    // Territories / freely associated states that use USPS codes.
    { value: 'AS', label: 'American Samoa', },
    { value: 'GU', label: 'Guam', },
    { value: 'MP', label: 'Northern Mariana Islands', },
    { value: 'PR', label: 'Puerto Rico', },
    { value: 'VI', label: 'U.S. Virgin Islands', },
    { value: 'AA', label: 'Armed Forces Americas', },
    { value: 'AE', label: 'Armed Forces Europe', },
    { value: 'AP', label: 'Armed Forces Pacific', },
];

const STATE_VALUES = new Set(US_STATES.map((s,) => s.value),);

/** True when `value` is a USPS code in the list above. */
export function isKnownUsState(value: string,): boolean {
    return STATE_VALUES.has(value,);
}

/**
 * Map a legacy/free-text state value onto its USPS code. Handles the code itself
 * (any case) and the full name (`Pennsylvania` → `PA`). Returns null when there
 * is no confident match, so callers can keep the raw value rather than guess.
 */
export function normalizeUsState(raw: string | null | undefined,): string | null {
    if (!raw) return null;
    const v = raw.trim();
    if (!v) return null;
    const upper = v.toUpperCase();
    if (STATE_VALUES.has(upper,)) return upper;
    const byName = US_STATES.find((s,) => s.label.toLowerCase() === v.toLowerCase());
    return byName ? byName.value : null;
}
