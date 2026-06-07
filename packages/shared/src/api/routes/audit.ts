/**
 * Wire DTOs for the /audit module. Validation schema lives in
 * `packages/api/src/routes/audit.ts`.
 */

/** Query for GET /api/v1/audit. Out-of-range page/limit are clamped
 *  server-side rather than rejected. */
export interface AuditListQuery {
    entityType?: string;
    action?: string;
    userId?: string;
    /** ISO date bounds. */
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}

/** One audit-log entry as returned by the list endpoint (acting user
 *  joined for display). */
export interface AuditLogEntry {
    id: string;
    userId: string | null;
    userDisplayName: string | null;
    userEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
}

/** GET /api/v1/audit — entries. Page meta rides the envelope. */
export type AuditListResponse = AuditLogEntry[];
