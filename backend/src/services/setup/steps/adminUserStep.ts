import bcrypt from 'bcryptjs';
import { AppError, ConflictError, } from '../../../core/errors';
import type { InstallContext, InstallStep, } from './InstallStep';

/**
 * Creates the admin user when the wizard's admin section is enabled. If
 * disabled, this step is a no-op (admin can be created later via CLI
 * seed or directly in the DB). Duplicate-email errors are surfaced
 * inline to the wizard's `email` field.
 */
export const adminUserStep: InstallStep = {
    id: 'admin-user',
    section: 'admin-user',
    isApplicable: (ctx,) => ctx.input.adminUser.enabled,

    async execute(ctx: InstallContext,): Promise<void> {
        if (!ctx.pool) throw new AppError(500, 'ADMIN_NEEDS_POOL', 'No DB pool for admin creation',);

        const { email, password, displayName, } = ctx.input.adminUser;
        if (!email || !password) {
            throw new AppError(400, 'ADMIN_FIELDS_MISSING', 'Email and password are required',);
        }

        const existing = await ctx.pool.query<{ id: string; }>(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
            [email,],
        );
        if (existing.rowCount && existing.rowCount > 0) {
            throw new ConflictError(
                'A user with that email already exists',
                { section: 'admin-user', field: 'email', code: 'EmailExists', },
            );
        }

        const hash = await bcrypt.hash(password, 12,);
        const result = await ctx.pool.query<{ id: string; }>(
            `INSERT INTO users (email, password_hash, display_name, role, auth_provider, is_active)
             VALUES ($1, $2, $3, 'admin', 'email', true)
             RETURNING id`,
            [email.toLowerCase(), hash, displayName ?? 'Admin',],
        );
        ctx.adminId = result.rows[0].id;
        ctx.scratch.adminEmail = email.toLowerCase();
    },

    async rollback(ctx: InstallContext,): Promise<void> {
        if (!ctx.pool || !ctx.adminId) return;
        await ctx.pool.query('DELETE FROM users WHERE id = $1', [ctx.adminId,],).catch(() => {/* ignore */});
        ctx.adminId = undefined;
    },
};
