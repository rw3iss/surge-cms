import { ModuleBase, } from './base';

export type ExportFormat = 'csv' | 'print';
/** The table's current query (search / sort / filter …) plus the format. */
export type ExportQuery = Record<string, string | number | boolean | undefined | null>;

/**
 * exports namespace (admin, `data:export`) — URL builders, not fetches. An
 * export is opened by NAVIGATION: `csv` downloads a file, `print` opens a
 * standalone printable page in a new tab; both authenticate with the session
 * cookie. Pass the same query the admin table uses so the export matches it.
 */
export class ExportsModule extends ModuleBase {
    protected readonly module = 'exports';

    private url(path: string, format: ExportFormat, query: ExportQuery = {},): string {
        const qs = new URLSearchParams({ format, },);
        for (const [k, v,] of Object.entries(query,)) {
            if (v !== undefined && v !== null && v !== '') qs.set(k, String(v,),);
        }
        return `${this.core.config.apiBase}${path}?${qs.toString()}`;
    }

    /** GET /exports/campaigns/:id/donations — `search`, `sortBy`, `sortOrder`. */
    campaignDonationsUrl(campaignId: string, format: ExportFormat, query?: ExportQuery,): string {
        return this.url(`/exports/campaigns/${encodeURIComponent(campaignId,)}/donations`, format, query,);
    }

    /** GET /exports/mailing-lists/:id/subscribers — `search`, `status`. */
    mailingListSubscribersUrl(listId: string, format: ExportFormat, query?: ExportQuery,): string {
        return this.url(`/exports/mailing-lists/${encodeURIComponent(listId,)}/subscribers`, format, query,);
    }

    /** GET /exports/users — `search`, `role`, `status`, `sortBy`, `sortOrder`. */
    usersUrl(format: ExportFormat, query?: ExportQuery,): string {
        return this.url('/exports/users', format, query,);
    }

    /** GET /exports/entities/:type — `search`, `status`, `filter` (JSON), `sortBy`, `sortOrder`. */
    entitiesUrl(typeKey: string, format: ExportFormat, query?: ExportQuery,): string {
        return this.url(`/exports/entities/${encodeURIComponent(typeKey,)}`, format, query,);
    }
}
