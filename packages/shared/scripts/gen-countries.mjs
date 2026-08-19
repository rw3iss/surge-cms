/**
 * Regenerates `src/utils/countries.ts`.
 *
 * Country NAMES come from Node/ICU (`Intl.DisplayNames`) so 200+ strings aren't
 * hand-maintained; the ISO 3166-1 alpha-2 CODE list is the input (ICU has no
 * "list all regions" API). Sorted alphabetically by name, with United States
 * pinned first.
 *
 * Run:  node packages/shared/scripts/gen-countries.mjs
 */
import { writeFileSync, } from 'node:fs';
import { fileURLToPath, } from 'node:url';
import path from 'node:path';

/** ISO 3166-1 alpha-2, officially assigned. */
const CODES = [
    'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
    'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
    'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
    'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
    'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
    'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
    'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
    'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
    'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
    'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
    'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
    'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
    'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
    'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
    'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
    'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/** Pinned to the top of the list. */
const PINNED = 'US';

/**
 * Alpha-3 → alpha-2 for codes that turn up in imported CRM data. ICU cannot map
 * these for us, and the historic free-text field stored alpha-3 (`USA`, `CAN`).
 */
const ALPHA3 = {
    USA: 'US', CAN: 'CA', MEX: 'MX', GBR: 'GB', IRL: 'IE', FRA: 'FR', DEU: 'DE', ESP: 'ES',
    ITA: 'IT', NLD: 'NL', BEL: 'BE', CHE: 'CH', AUT: 'AT', SWE: 'SE', NOR: 'NO', DNK: 'DK',
    FIN: 'FI', POL: 'PL', PRT: 'PT', GRC: 'GR', CZE: 'CZ', HUN: 'HU', ROU: 'RO', UKR: 'UA',
    RUS: 'RU', TUR: 'TR', ISR: 'IL', ARE: 'AE', SAU: 'SA', IND: 'IN', PAK: 'PK', BGD: 'BD',
    CHN: 'CN', JPN: 'JP', KOR: 'KR', TWN: 'TW', HKG: 'HK', SGP: 'SG', MYS: 'MY', THA: 'TH',
    VNM: 'VN', PHL: 'PH', IDN: 'ID', AUS: 'AU', NZL: 'NZ', ZAF: 'ZA', NGA: 'NG', KEN: 'KE',
    EGY: 'EG', MAR: 'MA', GHA: 'GH', ETH: 'ET', BRA: 'BR', ARG: 'AR', CHL: 'CL', COL: 'CO',
    PER: 'PE', VEN: 'VE', ECU: 'EC', URY: 'UY', PRY: 'PY', BOL: 'BO', CRI: 'CR', PAN: 'PA',
    GTM: 'GT', HND: 'HN', SLV: 'SV', NIC: 'NI', DOM: 'DO', CUB: 'CU', JAM: 'JM', HTI: 'HT',
    TTO: 'TT', PRI: 'PR',
};

const names = new Intl.DisplayNames(['en'], { type: 'region' });

const all = CODES
    .map((code) => ({ value: code, label: names.of(code) ?? code }))
    .filter((c) => c.label !== c.value); // drop anything ICU can't name

all.sort((a, b) => a.label.localeCompare(b.label));

const pinned = all.find((c) => c.value === PINNED);
const ordered = pinned ? [pinned, ...all.filter((c) => c.value !== PINNED)] : all;

const countryRows = ordered
    .map((c) => `    { value: ${JSON.stringify(c.value)}, label: ${JSON.stringify(c.label)}, },`)
    .join('\n');

const alpha3Rows = Object.entries(ALPHA3)
    .map(([a3, a2]) => `    ${a3}: '${a2}',`)
    .join('\n');

const out = [
    '/**',
    ' * Static ISO 3166-1 country list for country dropdowns (e.g. the /profile +',
    " * CRM contact \"Country\" field). Names come from Node/ICU's `Intl.DisplayNames`.",
    ' * Values are alpha-2 codes (e.g. `US`); labels are English names. Sorted by',
    ' * name with United States FIRST (by far the most common value on this install).',
    ' * Regenerate with `node packages/shared/scripts/gen-countries.mjs`.',
    ' */',
    'export interface CountryOption {',
    '    /** ISO 3166-1 alpha-2 code, e.g. `US`. */',
    '    value: string;',
    '    /** English country name, e.g. `United States`. */',
    '    label: string;',
    '}',
    '',
    'export const COUNTRIES: CountryOption[] = [',
    countryRows,
    '];',
    '',
    'const COUNTRY_VALUES = new Set(COUNTRIES.map((c,) => c.value),);',
    '',
    '/** True when `value` is an alpha-2 code in the list above. */',
    'export function isKnownCountry(value: string,): boolean {',
    '    return COUNTRY_VALUES.has(value,);',
    '}',
    '',
    '/** Alpha-3 → alpha-2 for codes that appear in imported CRM data. */',
    'const ALPHA3_TO_ALPHA2: Record<string, string> = {',
    alpha3Rows,
    '};',
    '',
    '/**',
    ' * Best-effort mapping of a legacy/free-text country value onto an alpha-2 code.',
    ' * Historic rows hold values like `USA`, `CAN` or `United States` (the field used',
    ' * to be a plain text input, and the CRM import carried alpha-3 codes), which the',
    ' * dropdown would otherwise treat as unrecognised. Returns null when there is no',
    ' * confident match — callers should then keep the raw value rather than guess.',
    ' */',
    'export function normalizeCountry(raw: string | null | undefined,): string | null {',
    '    if (!raw) return null;',
    '    const v = raw.trim();',
    '    if (!v) return null;',
    '    const upper = v.toUpperCase();',
    '    if (COUNTRY_VALUES.has(upper,)) return upper;',
    '    if (ALPHA3_TO_ALPHA2[upper]) return ALPHA3_TO_ALPHA2[upper];',
    '    const byName = COUNTRIES.find((c,) => c.label.toLowerCase() === v.toLowerCase());',
    '    return byName ? byName.value : null;',
    '}',
    '',
].join('\n');

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../src/utils/countries.ts',);
writeFileSync(target, out);
console.log(`Wrote ${target} (${ordered.length} countries, ${PINNED} first)`);
