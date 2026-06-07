import { AppError, } from '../../../core/errors';
import { runMigrations, } from '../../../db/migrator';
import type { InstallContext, InstallStep, } from './InstallStep';

export const migrationStep: InstallStep = {
    id: 'migrate',
    section: 'database',
    isApplicable: () => true,

    async execute(ctx: InstallContext,): Promise<void> {
        if (!ctx.pool) {
            throw new AppError(500, 'MIGRATIONS_NEED_POOL', 'No database pool available for migrations',);
        }
        try {
            await runMigrations(ctx.pool,);
        } catch (error) {
            throw new AppError(
                500,
                'MIGRATIONS_FAILED',
                `Migrations failed: ${(error as Error).message}`,
                { section: 'database', },
            );
        }
    },
};
