/**
 * The ONE builder for admin notification messages.
 *
 * Every `notify()` caller describes its event as data — who it is about
 * (`notifyUser`), a few labelled detail sections, and links — and
 * `renderNotification` turns that into an email-safe HTML body (table layout,
 * inline styles, ≤600px) plus a matching plain-text alternative. Every value
 * is HTML-escaped: most of it is visitor-supplied (names, form answers,
 * messages). Relative links are made absolute against the site's public URL.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { escapeHtml, } from '../../utils/html';
import { logger, } from '../../utils/logger';
import type { NotificationMessage, } from './channels';
import { brandedEmail, brandLayout, type BrandLayout, } from '../mail/branded';

// ─── Types ────────────────────────────────────────────────────────────────

export interface NotifyRow { label: string; value: string | number | null | undefined; }

export interface NotifySection {
    heading?: string;
    rows?: NotifyRow[];
    /** Free text shown as a paragraph (newlines kept). Escaped. */
    text?: string;
    /**
     * TRUSTED pre-rendered HTML (e.g. the shop's item table). Only for markup the
     * caller built and escaped itself — never visitor input. `text` is used for
     * the plain-text alternative.
     */
    html?: string;
}

export interface NotifyLink { label: string; url: string; }

/** The person an event is about. Account-less people carry an email only. */
export interface NotifyPerson {
    userId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    roles: string[];
    membership: { level: string; status: string | null; renews: string | null; } | null;
    joined: string | null;
    adminUrl: string | null;
}

export interface NotificationSpec {
    title: string;
    /** Defaults to `title`. */
    subject?: string;
    intro?: string;
    person?: NotifyPerson | null;
    /** Heading of the person table (default "Member"). */
    personHeading?: string;
    sections?: NotifySection[];
    links?: NotifyLink[];
    footer?: string;
    /** Public base URL for relative links (default: the configured site URL). */
    baseUrl?: string;
    /** The standard branded layout (logo header + footer). `buildNotification`
     *  fills it; without it the card has no branding (pure / tests). */
    layout?: BrandLayout | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** The site's public base URL: the `site_url` setting, else FRONTEND_URL. */
export async function siteBaseUrl(): Promise<string> {
    let url = '';
    try {
        const r = await query<{ value: unknown; }>(`SELECT value FROM site_settings WHERE key = 'site_url'`,);
        const v = r.rows[0]?.value;
        if (typeof v === 'string') url = v;
    } catch { /* fall through to config */ }
    return (url || config.frontendUrl || '').replace(/\/+$/, '',);
}

export function absoluteUrl(url: string, base: string,): string {
    if (/^https?:\/\//i.test(url,)) return url;
    return `${base.replace(/\/+$/, '',)}${url.startsWith('/',) ? '' : '/'}${url}`;
}

/** "2026-10-14T…" / Date → "Oct 14, 2026". Empty for missing/invalid input. */
export function formatDay(d: string | Date | null | undefined,): string {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d,);
    if (Number.isNaN(date.getTime(),)) return '';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC', },);
}

/** Stripe/local subscription status → words an operator reads at a glance. */
export function subscriptionStatusLabel(status: string | null | undefined,): string {
    switch (status) {
        case 'active': return 'Active';
        case 'trialing': return 'Active (trial / scheduled change)';
        case 'past_due': return 'Past due — payment failed';
        case 'unpaid': return 'Unpaid';
        case 'incomplete': return 'Awaiting first payment';
        case 'incomplete_expired': return 'Payment never completed';
        case 'canceled':
        case 'cancelled': return 'Cancelled';
        case 'paused': return 'Paused';
        default: return status ? status : '—';
    }
}

// ─── Person loader ────────────────────────────────────────────────────────

interface UserRow {
    id: string;
    email: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    role: string;
    extra_roles: string[] | null;
    created_at: Date;
}

async function contactPhone(userId: string | null, email: string | null,): Promise<{ phone: string | null; name: string | null; }> {
    // The Contacts feature (ce_contact) may not be installed — tolerate it.
    try {
        const r = await query<{ mobile_phone: string | null; primary_phone: string | null; first_name: string | null; last_name: string | null; }>(
            `SELECT mobile_phone, primary_phone, first_name, last_name FROM ce_contact
              WHERE ($1::uuid IS NOT NULL AND user_id = $1::uuid) OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2::text))
              ORDER BY (user_id IS NOT NULL AND user_id = $1::uuid) DESC, created_at ASC LIMIT 1`,
            [userId, email,],
        );
        const c = r.rows[0];
        if (!c) return { phone: null, name: null, };
        const name = [c.first_name, c.last_name,].filter(Boolean,).join(' ',).trim();
        return { phone: c.mobile_phone || c.primary_phone || null, name: name || null, };
    } catch {
        return { phone: null, name: null, };
    }
}

async function membershipOf(userId: string,): Promise<NotifyPerson['membership']> {
    try {
        const r = await query<{ name: string; status: string; current_period_end: Date | null; cancel_at_period_end: boolean | null; }>(
            `SELECT p.name, s.status, s.current_period_end, s.cancel_at_period_end
               FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
              WHERE s.user_id = $1 AND s.status IN ('active', 'trialing', 'past_due', 'incomplete')
              ORDER BY (s.status = 'incomplete') ASC, s.created_at DESC LIMIT 1`,
            [userId,],
        );
        const s = r.rows[0];
        if (s) {
            const day = formatDay(s.current_period_end,);
            return {
                level: s.name,
                status: subscriptionStatusLabel(s.status,),
                renews: day ? `${s.cancel_at_period_end ? 'Ends' : 'Renews'} ${day}` : null,
            };
        }
        const free = await query<{ name: string; }>(`SELECT name FROM subscription_plans WHERE is_free LIMIT 1`,);
        return free.rows[0] ? { level: free.rows[0].name, status: null, renews: null, } : null;
    } catch {
        return null;
    }
}

/**
 * Load the person an event is about. Never throws: a lookup failure falls
 * back to whatever the caller already knows (at least the email).
 */
export async function notifyUser(ref: { userId?: string | null; email?: string | null; name?: string | null; },): Promise<NotifyPerson | null> {
    const fallbackEmail = ref.email?.trim() || null;
    const base: NotifyPerson = {
        userId: null, name: ref.name?.trim() || null, email: fallbackEmail, phone: null,
        roles: [], membership: null, joined: null, adminUrl: null,
    };
    if (!ref.userId && !fallbackEmail) return ref.name ? base : null;
    try {
        let user: UserRow | undefined;
        const cols = `id, email, display_name, first_name, last_name, role, extra_roles, created_at`;
        if (ref.userId) {
            user = (await query<UserRow>(`SELECT ${cols} FROM users WHERE id = $1`, [ref.userId,],)).rows[0];
        }
        if (!user && fallbackEmail) {
            user = (await query<UserRow>(`SELECT ${cols} FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [fallbackEmail,],)).rows[0];
        }
        const contact = await contactPhone(user?.id ?? null, user?.email ?? fallbackEmail,);
        if (!user) return { ...base, name: base.name || contact.name, phone: contact.phone, };
        const fullName = [user.first_name, user.last_name,].filter(Boolean,).join(' ',).trim();
        return {
            userId: user.id,
            name: user.display_name || fullName || base.name || contact.name,
            email: user.email,
            phone: contact.phone,
            roles: await roleLabels([user.role, ...(user.extra_roles ?? []).filter((r,) => r !== user!.role),],),
            membership: await membershipOf(user.id,),
            joined: formatDay(user.created_at,) || null,
            adminUrl: `/admin/users/${user.id}`,
        };
    } catch (err) {
        logger.warn('notifyUser lookup failed', { error: (err as Error).message, },);
        return base;
    }
}

/** Role keys → their labels ("subscriber" → "Subscriber"); an unknown key stays as it is. */
async function roleLabels(keys: string[],): Promise<string[]> {
    if (!keys.length) return keys;
    try {
        const r = await query<{ key: string; label: string; }>(`SELECT key, label FROM roles WHERE key = ANY($1)`, [keys,],);
        const by = new Map(r.rows.map((x,) => [x.key, x.label,]),);
        return keys.map((k,) => by.get(k,) || k,);
    } catch {
        return keys;
    }
}

/** A short "Jane Doe" / "jane@x.com" label for subjects. */
export function personLabel(p: NotifyPerson | null | undefined, fallback = 'Someone',): string {
    return p?.name || p?.email || fallback;
}

// ─── Renderer ─────────────────────────────────────────────────────────────

const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;
const LABEL = `padding:6px 16px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;width:1%;`;
const VALUE = `padding:6px 0;color:#111827;font-size:14px;vertical-align:top;word-break:break-word;`;

function present(v: NotifyRow['value'],): v is string | number {
    return v !== null && v !== undefined && String(v,).trim() !== '';
}

function personRows(p: NotifyPerson,): NotifyRow[] {
    return [
        { label: 'Name', value: p.name, },
        { label: 'Email', value: p.email, },
        { label: 'Phone', value: p.phone, },
        { label: p.roles.length > 1 ? 'Roles' : 'Role', value: p.roles.join(', ',), },
        {
            label: 'Membership',
            value: p.membership
                ? [p.membership.level, p.membership.status, p.membership.renews,].filter(Boolean,).join(' · ',)
                : null,
        },
        { label: 'Joined', value: p.joined, },
        { label: 'Account', value: p.userId ? null : 'No account yet', },
    ];
}

function rowsHtml(rows: NotifyRow[],): string {
    const body = rows.filter((r,) => present(r.value,),).map((r,) =>
        `<tr><td style="${LABEL}">${escapeHtml(r.label,)}</td>`
        + `<td style="${VALUE}">${escapeHtml(String(r.value,),).replace(/\n/g, '<br>',)}</td></tr>`
    ).join('',);
    return body ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>` : '';
}

function sectionHtml(heading: string | undefined, inner: string,): string {
    if (!inner) return '';
    const h = heading
        ? `<h3 style="margin:0 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#374151;">${escapeHtml(heading,)}</h3>`
        : '';
    return `<tr><td style="padding:16px 24px 0;${FONT}">${h}${inner}</td></tr>`;
}

function rowsText(rows: NotifyRow[],): string {
    return rows.filter((r,) => present(r.value,),).map((r,) => `${r.label}: ${String(r.value,)}`,).join('\n',);
}

/** Render a notification spec to `{ subject, html, text }`. Pure. */
export function renderNotification(spec: NotificationSpec,): Required<Pick<NotificationMessage, 'subject' | 'html' | 'text'>> {
    const base = spec.baseUrl ?? (config.frontendUrl || '').replace(/\/+$/, '',);
    const links = (spec.links ?? []).filter((l,) => l.url,).map((l,) => ({ label: l.label, url: absoluteUrl(l.url, base,), }),);
    const person = spec.person ?? null;
    const personHeading = spec.personHeading ?? 'Member';

    // ── HTML
    const parts: string[] = [];
    parts.push(
        `<tr><td style="padding:24px 24px 0;${FONT}"><h2 style="margin:0;font-size:20px;line-height:1.3;color:#111827;">${escapeHtml(spec.title,)}</h2>`
            + (spec.intro ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#374151;">${escapeHtml(spec.intro,)}</p>` : '')
            + `</td></tr>`,
    );
    if (person) parts.push(sectionHtml(personHeading, rowsHtml(personRows(person,),),),);
    for (const s of spec.sections ?? []) {
        const inner = (s.rows?.length ? rowsHtml(s.rows,) : '')
            + (s.text ? `<p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#111827;white-space:pre-wrap;">${escapeHtml(s.text,).replace(/\n/g, '<br>',)}</p>` : '')
            + (s.html ?? '');
        parts.push(sectionHtml(s.heading, inner,),);
    }
    if (links.length) {
        const buttons = links.map((l, i,) =>
            `<a href="${escapeHtml(l.url,)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;`
            + (i === 0 ? 'background:#111827;color:#ffffff;' : 'background:#f3f4f6;color:#111827;border:1px solid #d1d5db;')
            + `">${escapeHtml(l.label,)}</a>`
        ).join('',);
        parts.push(`<tr><td style="padding:20px 24px 0;${FONT}">${buttons}</td></tr>`,);
    }
    if (spec.footer) {
        parts.push(`<tr><td style="padding:16px 24px 0;${FONT}font-size:12px;color:#6b7280;">${escapeHtml(spec.footer,)}</td></tr>`,);
    }
    const rows = parts.filter(Boolean,).join('',) + `<tr><td style="padding:0 0 24px;"></td></tr>`;
    const html = spec.layout
        ? brandedEmail(rows, spec.layout, { title: spec.subject ?? spec.title, },)
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;"><tr><td align="center" style="padding:16px;">`
            + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;">`
            + rows
            + `</table></td></tr></table>`;

    // ── Text
    const t: string[] = [spec.title,];
    if (spec.intro) t.push('', spec.intro,);
    if (person) {
        const block = rowsText(personRows(person,),);
        if (block) t.push('', `== ${personHeading} ==`, block,);
    }
    for (const s of spec.sections ?? []) {
        const block = [s.rows?.length ? rowsText(s.rows,) : '', s.text ?? '',].filter(Boolean,).join('\n',);
        if (!block) continue;
        t.push('', s.heading ? `== ${s.heading} ==` : '', block,);
    }
    if (links.length) t.push('', ...links.map((l,) => `${l.label}: ${l.url}`,),);
    if (spec.footer) t.push('', spec.footer,);

    return {
        subject: spec.subject ?? spec.title,
        html,
        text: t.filter((line, i, arr,) => !(line === '' && arr[i - 1] === '')).join('\n',).trim(),
    };
}

/** `renderNotification` with the site's configured public URL resolved. */
export async function buildNotification(spec: NotificationSpec,): Promise<Required<Pick<NotificationMessage, 'subject' | 'html' | 'text'>>> {
    const layout = spec.layout !== undefined ? spec.layout : await brandLayout().catch(() => null);
    return renderNotification({ ...spec, baseUrl: spec.baseUrl ?? await siteBaseUrl(), layout, },);
}
