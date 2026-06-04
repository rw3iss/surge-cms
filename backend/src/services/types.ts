/**
 * Shared SDK types.
 *
 * Every capability under `sdk/` aims to satisfy the `Service` contract
 * below. Capabilities don't have to implement every method — fonts
 * has no `update`, settings is keyed by string instead of UUID — but
 * when they DO implement these names, they keep the same signatures
 * so consumers (routes, scripts, future plugins) can lean on
 * structural typing.
 *
 * Cache invalidation and audit logging both live at this layer; see
 * `2026-04-28-cms-sdk-design.md` for the rationale.
 */

/** Pagination parameters every list-style query accepts. */
export interface PaginationOpts {
    page?: number;
    limit?: number;
}

/** Standard list-result shape. Mirrors the existing repo paginated
 *  result so capability modules can pass it through unchanged. */
export interface ListResult<T,> {
    data: T[];
    /** Optional pagination metadata. Empty for capabilities that
     *  don't paginate (e.g. fonts is small enough to dump fully). */
    meta?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

/**
 * Context passed into every write. Carries the acting user + request
 * provenance so the SDK can log audit trails identically regardless
 * of whether the caller is an HTTP route, a script, or a plugin.
 *
 * The route layer fills this from `req.user` / `req.ip` / `req.headers`.
 * Scripts that act as the system supply `userId: 'system'` (or a
 * dedicated service-account UUID) and leave ip/UA undefined.
 */
export interface AuditContext {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
}

/** Convenience: build an AuditContext from common Express props.
 *  Hoisted into the type module so callers don't have to import a
 *  helper file just to construct one. */
export function auditFromRequest(req: {
    userId?: string;
    user?: { id?: string; };
    ip?: string;
    get?: (header: string,) => string | undefined;
},): AuditContext {
    const userId = req.userId || req.user?.id || 'system';
    return {
        userId,
        ipAddress: req.ip,
        userAgent: req.get?.('user-agent',),
    };
}

/**
 * Base contract for typical CRUD-shaped capabilities. Capabilities
 * with non-CRUD shapes (settings, single-row stores, etc.) are free
 * to expose a different surface.
 *
 *   TEntity  — the row shape returned by reads.
 *   TCreate  — the input accepted by `create`. Often the entity minus
 *              server-managed fields (id, createdAt, etc.).
 *   TUpdate  — the input accepted by `update`. Usually a partial.
 *   TFilters — list-time filter shape. `void` when none.
 */
export interface Service<TEntity, TCreate, TUpdate, TFilters = void,> {
    list(filters?: TFilters, pagination?: PaginationOpts,): Promise<ListResult<TEntity>>;
    getById(id: string,): Promise<TEntity | null>;
    create(input: TCreate, ctx: AuditContext,): Promise<TEntity>;
    update(id: string, patch: TUpdate, ctx: AuditContext,): Promise<TEntity>;
    remove(id: string, ctx: AuditContext,): Promise<TEntity | null>;
}
