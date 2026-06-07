/**
 * CLI wrapper around `migrator.ts`. The migration logic itself is in
 * `migrator.ts` so the setup wizard can run it in-process. This file
 * stays thin and only adds process-level lifecycle: arg parsing, exit
 * codes, and pool teardown.
 */
import { closePool, getPool, } from './client';
import { getMigrationStatus, runMigrations, } from './migrator';

async function showStatus(): Promise<void> {
    const statuses = await getMigrationStatus(getPool(),);
    console.log('\nMigration Status',);
    console.log('================\n',);
    let pending = 0;
    for (const s of statuses) {
        if (!s.applied) pending++;
        console.log(`  ${s.applied ? '[x]' : '[ ]'} ${s.filename}`,);
    }
    console.log('\nApplied migration details:',);
    for (const s of statuses) {
        if (s.applied && s.appliedAt) {
            console.log(`  ${s.filename} - applied at ${s.appliedAt.toISOString()}`,);
        }
    }
    console.log(`\nTotal: ${statuses.length} migrations, ${pending} pending\n`,);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2,);
    try {
        if (args.includes('--status',)) {
            await showStatus();
        } else {
            await runMigrations(getPool(),);
        }
    } finally {
        await closePool();
    }
}

main().catch((error,) => {
    console.error('Migration command failed:', error,);
    process.exit(1,);
},);
