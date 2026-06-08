import type { AuditListQuery, AuditListResponse, } from '@rw/cms-shared';
import { ModuleBase, } from './base';

/** /audit namespace (admin) — read-only audit-log view. */
export class AuditModule extends ModuleBase {
    protected readonly module = 'audit';

    /** GET /audit — paginated entries (entity/action/user/date filters). Page meta on the envelope. */
    list(query?: AuditListQuery,): Promise<AuditListResponse> {
        return this.get<AuditListResponse>('/audit', { query: query as Record<string, unknown>, },);
    }
}
