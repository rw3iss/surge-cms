/** Social analytics settings (`social_analytics_settings`): digest schedule, sections, email, retention. */
import {
    DEFAULT_SOCIAL_ANALYTICS_SETTINGS,
    DIGEST_SECTIONS,
    type DigestSection,
    type SocialAnalyticsSettings,
    type SocialAnalyticsSettingsBody,
} from '@sitesurge/types';
import { ValidationError, } from '../../../core/errors';
import { defaultTimezone, } from '../../mailSchedules';
import * as settingsService from '../../settings';
import type { AuditContext, } from '../../types';

export const SETTINGS_KEY = 'social_analytics_settings';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getSettings(): Promise<SocialAnalyticsSettings> {
    const raw = await settingsService.get<Partial<SocialAnalyticsSettings>>(SETTINGS_KEY,).catch(() => null);
    const d = DEFAULT_SOCIAL_ANALYTICS_SETTINGS;
    return {
        // Until saved, the digest follows the site's default time zone.
        digest: { ...d.digest, timezone: await defaultTimezone(), ...(raw?.digest ?? {}), },
        email: { ...d.email, ...(raw?.email ?? {}), },
        retentionDays: raw && 'retentionDays' in raw ? raw.retentionDays ?? null : d.retentionDays,
        benchmarks: { ...d.benchmarks, ...(raw?.benchmarks ?? {}), },
    };
}

function int(v: unknown, min: number, max: number, label: string,): number {
    const n = Math.round(Number(v,),);
    if (!Number.isFinite(n,) || n < min || n > max) throw new ValidationError(`${label} must be ${min}–${max}.`,);
    return n;
}

function validTimezone(tz: string,): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz, },);
        return true;
    } catch {
        return false;
    }
}

/** Validate + normalise a full settings object. */
export function normalizeSettings(n: SocialAnalyticsSettings,): SocialAnalyticsSettings {
    const dg = n.digest;
    if (!['daily', 'weekly', 'monthly',].includes(dg.frequency,)) throw new ValidationError('Frequency must be daily, weekly or monthly.',);
    const tz = String(dg.timezone || 'America/New_York',).trim();
    if (!validTimezone(tz,)) throw new ValidationError(`Unknown time zone "${tz}".`,);
    const known = new Set(DIGEST_SECTIONS.map((s,) => s.key),);
    const sections = [...new Set((dg.sections ?? []).filter((s,): s is DigestSection => known.has(s as DigestSection,),),),];
    if (!sections.length) throw new ValidationError('Choose at least one digest section.',);
    const pool = String(dg.aiPool ?? '',).trim();
    if (pool && !/^[A-Za-z0-9_.-]{1,64}$/.test(pool,)) throw new ValidationError('AI pool: letters, digits, - _ . only.',);
    const recipients = [...new Set((n.email.recipients ?? []).map((a,) => String(a,).trim().toLowerCase(),).filter(Boolean,),),];
    const bad = recipients.find((a,) => !EMAIL_RE.test(a,),);
    if (bad) throw new ValidationError(`Not an email address: ${bad}`,);
    if (recipients.length > 100) throw new ValidationError('At most 100 extra recipients.',);
    let retention: number | null = null;
    if (n.retentionDays !== null && n.retentionDays !== undefined) retention = int(n.retentionDays, 1, 1_000_000, 'Retention (days)',);
    return {
        digest: {
            enabled: Boolean(dg.enabled,),
            frequency: dg.frequency,
            weekday: int(dg.weekday, 0, 6, 'Weekday',),
            monthDay: int(dg.monthDay, 1, 28, 'Day of month',),
            hour: int(dg.hour, 0, 23, 'Hour',),
            timezone: tz,
            platforms: [...new Set((dg.platforms ?? []).map(String,).filter(Boolean,),),].slice(0, 20,),
            sections,
            topPosts: int(dg.topPosts, 0, 50, 'Top posts',),
            aiPool: pool || 'analytics',
        },
        email: {
            enabled: Boolean(n.email.enabled,),
            format: n.email.format === 'summary' ? 'summary' : 'full',
            recipients,
            recipientMode: n.email.recipientMode === 'override' ? 'override' : 'augment',
        },
        retentionDays: retention,
        benchmarks: { instagram: igUsernames(n.benchmarks?.instagram ?? [],), facebook: fbPages(n.benchmarks?.facebook ?? [],), },
    };
}

const IG_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const FB_PAGE_RE = /^[A-Za-z0-9.\-]{1,100}$/;

/** Facebook Pages by username or numeric id (a pasted facebook.com URL keeps its last path part). */
function fbPages(list: string[],): string[] {
    const out = [...new Set(list.map((u,) => String(u,).trim().replace(/^https?:\/\/(www\.|m\.)?facebook\.com\//i, '',).replace(/[/?#].*$/, '',).replace(/^@/, '',),).filter(Boolean,),),];
    const bad = out.find((u,) => !FB_PAGE_RE.test(u,),);
    if (bad) throw new ValidationError(`Not a Facebook Page username or id: ${bad}`,);
    if (out.length > 20) throw new ValidationError('At most 20 Facebook benchmark Pages.',);
    return out;
}

function igUsernames(list: string[],): string[] {
    const out = [...new Set(list.map((u,) => String(u,).trim().replace(/^@/, '',).toLowerCase(),).filter(Boolean,),),];
    const bad = out.find((u,) => !IG_USERNAME_RE.test(u,),);
    if (bad) throw new ValidationError(`Not an Instagram username: ${bad}`,);
    if (out.length > 20) throw new ValidationError('At most 20 benchmark accounts.',);
    return out;
}

export async function updateSettings(patch: SocialAnalyticsSettingsBody, ctx: AuditContext,): Promise<SocialAnalyticsSettings> {
    const cur = await getSettings();
    const next = normalizeSettings({
        digest: { ...cur.digest, ...(patch.digest ?? {}), },
        email: { ...cur.email, ...(patch.email ?? {}), },
        retentionDays: patch.retentionDays === undefined ? cur.retentionDays : patch.retentionDays,
        benchmarks: { ...cur.benchmarks, ...(patch.benchmarks ?? {}), },
    },);
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}
