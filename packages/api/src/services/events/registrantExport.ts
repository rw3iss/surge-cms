/**
 * One occurrence's registrants as an export dataset (CSV / printable page with
 * ticket codes — a door list). Same rows as the admin Registrants table, every
 * page, with the event's extra registration answers as their own columns.
 */
import { formatCurrency, } from '@sitesurge/types';
import { collectAll, deriveColumns, type ExportDataset, type Row, } from '../export/dataset';
import { getByIdOrSlug, } from './crud';
import { listRegistrations, } from './registration';

export async function registrantsDataset(eventId: string, occurrenceDate: string,): Promise<ExportDataset> {
    const event = await getByIdOrSlug(eventId,);
    const rows = await collectAll(async (page, limit,) => {
        const r = await listRegistrations(event.id, occurrenceDate, { page, limit: Math.min(limit, 200,), },);
        return {
            rows: r.data.map((reg,): Row => {
                const tickets = reg.tickets ?? [];
                const fields = (reg.fields ?? {}) as Record<string, unknown>;
                return {
                    name: reg.name ?? '',
                    email: reg.email,
                    phone: reg.phone ?? '',
                    status: reg.status,
                    registeredAt: reg.createdAt,
                    tickets: tickets.map((t,) => `${t.code} (${t.tierName}${t.status !== 'valid' ? `, ${t.status}` : ''})`,).join('; ',),
                    ticketCount: tickets.length,
                    paid: tickets.length
                        ? formatCurrency(tickets.reduce((s, t,) => s + (t.priceCentsPaid || 0), 0,), (tickets[0].currency || 'USD').toUpperCase(),)
                        : '',
                    // The event's own questions (organization, notes …), one column each.
                    ...Object.fromEntries(Object.entries(fields,).map(([k, v,],) => [`field_${k}`, v,],),),
                };
            },),
            total: r.total,
        };
    }, 200,);
    return {
        title: `${event.title} — registrants ${occurrenceDate}`,
        columns: deriveColumns(rows, {
            preferred: ['name', 'email', 'phone', 'tickets', 'ticketCount', 'paid', 'status', 'registeredAt',],
            labels: Object.fromEntries(
                [...new Set(rows.flatMap((r,) => Object.keys(r,).filter((k,) => k.startsWith('field_',),),),),]
                    .map((k,) => [k, k.slice(6,).replace(/_/g, ' ',).replace(/\b\w/g, (c,) => c.toUpperCase(),),],),
            ),
        },),
        printColumns: ['name', 'email', 'tickets', 'status',],
        rows,
    };
}
