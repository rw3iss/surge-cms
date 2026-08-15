/**
 * Regenerate `src/utils/timezones.ts` from Node/ICU's IANA time-zone data.
 * Run: `node packages/shared/scripts/gen-timezones.mjs` (from the repo root).
 *
 * Offsets are STANDARD-TIME (computed at a fixed January date), so the label's
 * `(GMT-5)` reflects standard time, not DST. Sorted west→east.
 */
import { writeFileSync, } from 'node:fs';
import { fileURLToPath, } from 'node:url';
import { dirname, join, } from 'node:path';

const zones = Intl.supportedValuesOf('timeZone');
const ref = new Date('2025-01-15T12:00:00Z'); // fixed → standard-time offsets

function offStr(tz) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset', })
        .formatToParts(ref).find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-5"
}
function offMin(s) {
    const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}
function label(tz, o) {
    const parts = tz.split('/');
    const name = parts.length === 1 ? tz : `${parts[0]} - ${parts.slice(1).join('/').replace(/_/g, ' ')}`;
    return `${name} (${o})`;
}

const list = zones.map((z) => {
    const o = offStr(z);
    return { value: z, label: label(z, o), offsetMinutes: offMin(o), };
});
list.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));

const rows = list
    .map((t) => `    { value: ${JSON.stringify(t.value)}, label: ${JSON.stringify(t.label)}, offsetMinutes: ${t.offsetMinutes}, },`)
    .join('\n');

const content = `/**
 * Static IANA time-zone list for time-zone dropdowns (e.g. the /profile + CRM
 * contact "Time zone" field). Generated from Node/ICU's
 * \`Intl.supportedValuesOf("timeZone")\` with standard-time (January) UTC offsets,
 * sorted west→east. Values are IANA ids (e.g. \`America/New_York\`); labels read
 * like \`America - New York (GMT-5)\`. Regenerate with
 * \`node packages/shared/scripts/gen-timezones.mjs\` (offsets are standard-time,
 * so DST is not reflected in the label).
 */
export interface TimeZoneOption {
    /** IANA time-zone id, e.g. \`America/New_York\`. */
    value: string;
    /** Human label, e.g. \`America - New York (GMT-5)\`. */
    label: string;
    /** Standard-time UTC offset in minutes (used for sorting; may differ under DST). */
    offsetMinutes: number;
}

export const TIMEZONES: TimeZoneOption[] = [
${rows}
];

/** True when \`value\` is a known IANA time-zone id in TIMEZONES. */
export function isKnownTimeZone(value: string,): boolean {
    return TIMEZONES.some((t,) => t.value === value,);
}
`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'timezones.ts');
writeFileSync(out, content);
console.log(`wrote ${list.length} time zones -> ${out}`);
