/**
 * Export SOURCES — one per admin table that can be exported. Each reuses the
 * table's own list function (same search / filter / sort), walks every page,
 * and derives its columns from the data. Add a source here and to
 * `routes/exports.ts`; the formats and the UI need nothing new.
 */
import { NotFoundError, } from '../../core/errors';
import * as entityManager from '../../entities/entityManager';
import * as campaigns from '../campaigns';
import * as entities from '../entities';
import * as mailingLists from '../mailingLists';
import * as users from '../users';
import { collectAll, deriveColumns, type ExportDataset, type Row, } from './dataset';

/**
 * Keys that never leave the server in an export, whatever the source:
 * password hashes, reset/verification/refresh tokens, OAuth secrets. Matched
 * by NAME so a column added later is covered without anyone remembering to.
 */
const SENSITIVE_KEY = /(password|token|secret|hash)/i;
const omitSensitive = (rows: Row[],) => [...new Set(rows.flatMap((r,) => Object.keys(r,)),),].filter((k,) => SENSITIVE_KEY.test(k,));

/** "search: x · sorted by amount ↓" for the printed heading. */
function describe(q: { search?: string; sortBy?: string; sortOrder?: string; [k: string]: unknown; }, extra: string[] = [],): string | undefined {
    const parts = [...extra,];
    if (q.search) parts.push(`search “${q.search}”`,);
    if (q.sortBy) parts.push(`sorted by ${q.sortBy}${q.sortOrder === 'asc' ? ' ↑' : q.sortOrder === 'desc' ? ' ↓' : ''}`,);
    return parts.length ? parts.join(' · ',) : undefined;
}

// ─── campaign donations ──────────────────────────────────────────────────
export async function campaignDonations(
    campaignId: string,
    q: { search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; },
): Promise<ExportDataset> {
    const campaign = await campaigns.getById(campaignId,);
    if (!campaign) throw new NotFoundError('Campaign',);
    const rows = await collectAll(async (page, limit,) => {
        const r = await campaigns.listCampaignDonationsAdmin(campaignId, { page, limit, search: q.search, sortBy: q.sortBy, sortOrder: q.sortOrder, },);
        return { rows: r.data as Row[], total: r.meta?.total ?? r.data.length, };
    },);
    return {
        title: `${campaign.title} — donations`,
        subtitle: describe(q,),
        columns: deriveColumns(rows, {
            preferred: ['donorName', 'name', 'donorEmail', 'email', 'amount', 'amountCents', 'status', 'createdAt', 'date',],
            omit: omitSensitive(rows,),
        },),
        printColumns: ['donorName', 'name', 'donorEmail', 'email', 'amount', 'amountCents', 'recurringInterval', 'visibility', 'status', 'createdAt',],
        rows,
    };
}

// ─── mailing list subscribers ────────────────────────────────────────────
export async function mailingListSubscribers(
    listId: string,
    q: { search?: string; status?: string; },
): Promise<ExportDataset> {
    const list = await mailingLists.getById(listId,);
    if (!list) throw new NotFoundError('Mailing list',);
    const rows = await collectAll(async (page, limit,) => {
        const r = await mailingLists.listSubscribers(listId, {
            limit, offset: (page - 1) * limit, search: q.search,
            status: q.status as Parameters<typeof mailingLists.listSubscribers>[1]['status'],
        },);
        return { rows: r.items as unknown as Row[], total: r.total, };
    },);
    return {
        title: `${list.name} — subscribers`,
        subtitle: describe(q, q.status ? [`status ${q.status}`,] : [],),
        columns: deriveColumns(rows, { preferred: ['name', 'email', 'phone', 'status', 'subscribedAt',], omit: omitSensitive(rows,), },),
        printColumns: ['name', 'email', 'phone', 'status', 'subscribedAt',],
        rows,
    };
}

// ─── users ───────────────────────────────────────────────────────────────
export async function allUsers(q: { search?: string; role?: string; status?: string; sortBy?: string; sortOrder?: string; },): Promise<ExportDataset> {
    const rows = await collectAll(async (page, limit,) => {
        const r = await users.list({ search: q.search, role: q.role, status: q.status, sortBy: q.sortBy, sortOrder: q.sortOrder, }, { page, limit, },);
        return { rows: r.data as unknown as Row[], total: r.meta?.total ?? r.data.length, };
    },);
    return {
        title: 'Users',
        subtitle: describe(q, [q.role ? `role ${q.role}` : '', q.status ? `status ${q.status}` : '',].filter(Boolean,),),
        columns: deriveColumns(rows, {
            preferred: ['displayName', 'firstName', 'lastName', 'email', 'role', 'isActive', 'emailVerified', 'createdAt', 'lastLoginAt',],
            omit: omitSensitive(rows,),
        },),
        printColumns: ['displayName', 'firstName', 'lastName', 'email', 'role', 'createdAt', 'lastLoginAt',],
        rows,
    };
}

// ─── any entity type ─────────────────────────────────────────────────────
/** snake_case field key → the camelCase key records carry. */
const camel = (k: string,) => k.replace(/_([a-z0-9])/g, (_m, c: string,) => c.toUpperCase(),);

/**
 * The printed page's columns for an entity type. A type can name its own set
 * (a CRM contact reads as name / email / phones / city / state); otherwise the
 * first schema fields that read well on paper — relation ids, long text, rich
 * text, JSON and block trees are skipped. "Print — all columns" still has
 * everything. Both key spellings are listed (schema snake_case, record camel).
 */
const PRINT_FIELDS: Record<string, string[]> = {
    contact: ['firstName', 'lastName', 'email', 'mobilePhone', 'primaryPhone', 'city', 'state',],
};
const NOT_PRINTABLE = new Set(['relation', 'longtext', 'richtext', 'json', 'blocks',],);

function printColumnsFor(type: { key: string; hasSlug: boolean; hasStatus: boolean; fields: { key: string; type: string; }[]; },): string[] {
    const both = (k: string,) => [k, camel(k,), k.replace(/[A-Z]/g, (c,) => `_${c.toLowerCase()}`,),];
    const named = PRINT_FIELDS[type.key];
    if (named) return named.flatMap(both,);
    return [
        ...(type.hasSlug ? ['slug',] : []),
        ...type.fields.filter((f,) => !NOT_PRINTABLE.has(f.type,),).slice(0, 8,).flatMap((f,) => both(f.key,),),
        ...(type.hasStatus ? ['status',] : []),
    ];
}

export async function entityRecords(
    typeKey: string,
    q: { search?: string; status?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; filter?: unknown; },
): Promise<ExportDataset> {
    const type = entityManager.getType(typeKey,);
    if (!type) throw new NotFoundError('Entity type',);
    const rows = await collectAll(async (page, limit,) => {
        const r = await entities.list(typeKey, { page, limit, search: q.search, status: q.status, sortBy: q.sortBy, sortOrder: q.sortOrder, filter: q.filter, } as never, { admin: true, },);
        return { rows: r.items as unknown as Row[], total: r.total, };
    }, 200,);

    // Columns from the LIVE schema: its fields in their defined order (both key
    // spellings), labelled with their own labels; anything else in the data
    // follows. A field added to the type appears here with no code change.
    const labels: Record<string, string> = {};
    const preferred: string[] = [];
    for (const f of type.fields) {
        for (const k of [f.key, camel(f.key,),]) {
            labels[k] = f.label;
            preferred.push(k,);
        }
    }
    const lead = ['id', ...(type.hasSlug ? ['slug',] : []), ...(type.hasStatus ? ['status',] : []),];
    const tail = ['createdAt', 'updatedAt',];
    const filterNote = q.filter ? ['filtered',] : [];
    return {
        title: type.labelPlural || type.label || typeKey,
        subtitle: describe(q, [...(q.status ? [`status ${q.status}`,] : []), ...filterNote,],),
        columns: deriveColumns(rows, { preferred: [...lead, ...preferred,].filter((k, i, a,) => a.indexOf(k,) === i), labels, omit: omitSensitive(rows,), },)
            // Timestamps read best last.
            .sort((a, b,) => Number(tail.includes(a.key,),) - Number(tail.includes(b.key,),)),
        printColumns: printColumnsFor(type,),
        rows,
    };
}
