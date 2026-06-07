/**
 * Wire types shared across multiple route-DTO modules. These mirror
 * backend helper return shapes that several endpoints reuse (e.g. the
 * bulk-action runner). Keeping one definition here avoids per-module
 * duplication.
 */

/** Result of a bulk status-change / soft-delete action (POST /<x>/bulk). */
export interface BulkActionResult {
    updated: number;
    action: 'delete' | 'status';
}
