/**
 * CLI wrapper for the seeder. The previous version hardcoded an admin
 * email/password and ran demo content as one tightly-coupled block; the
 * new version delegates to `seeder.ts` and lets the user opt into demo
 * content with `--demo`. The setup wizard skips this CLI entirely and
 * calls `runSeed()` directly.
 */
import bcrypt from 'bcryptjs';
import { closePool, getPool, query, } from './client';
import { runSeed, } from './seeder';
import { logger, } from '../utils/logger';

async function ensureCliAdmin(): Promise<string> {
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeThisPassword123!';
    const hash = await bcrypt.hash(adminPassword, 12,);
    const result = await query<{ id: string; }>(
        `INSERT INTO users (email, password_hash, display_name, role, auth_provider, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
         RETURNING id`,
        [adminEmail, hash, 'Admin', 'admin', 'email', true,],
    );
    logger.info(`CLI seed admin: ${adminEmail}`,);
    return result.rows[0].id;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2,);
    const includeSampleContent = args.includes('--demo',);
    try {
        const adminId = await ensureCliAdmin();
        await runSeed(getPool(), { adminId, includeSampleContent, },);
        logger.info('Seed complete',);
    } finally {
        await closePool();
    }
}

main().catch((error,) => {
    console.error('Seeding failed:', error,);
    process.exit(1,);
},);
