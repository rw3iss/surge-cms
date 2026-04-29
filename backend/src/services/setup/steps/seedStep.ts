import { AppError, } from '../../../core/errors';
import { runSeed, } from '../../../db/seeder';
import type { InstallContext, InstallStep, } from './InstallStep';

/**
 * Runs the default-settings seed and, if requested, the sample-content
 * seed. Sample content is opt-in (`includeSampleContent` on the
 * installer payload) because most fresh installs want a clean slate.
 */
export const seedStep: InstallStep = {
    id: 'seed',
    section: 'general',
    isApplicable: () => true,

    async execute(ctx: InstallContext,): Promise<void> {
        if (!ctx.pool) throw new AppError(500, 'SEED_NEEDS_POOL', 'No DB pool for seeding',);
        await runSeed(ctx.pool, {
            adminId: ctx.adminId ?? null,
            includeSampleContent: Boolean(ctx.input.includeSampleContent,),
        },);
    },
};
