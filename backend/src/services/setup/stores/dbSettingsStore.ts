import type { Pool, } from 'pg';
import type { ConfigStore, } from './ConfigStore';

/**
 * Reads/writes the `site_settings` table. Values are stored as JSON
 * strings (matching how `seed.ts` writes them) so the wizard's
 * "general" settings round-trip exactly the same shape as the running
 * app's settings panel.
 */
export class DbSettingsStore implements ConfigStore {
    constructor(private readonly pool: Pool,) {}

    async get(key: string,): Promise<string | undefined> {
        const r = await this.pool.query<{ value: string; }>(
            'SELECT value FROM site_settings WHERE key = $1',
            [key,],
        );
        return r.rowCount === 0 ? undefined : r.rows[0].value;
    }

    async has(key: string,): Promise<boolean> {
        const r = await this.pool.query<{ exists: boolean; }>(
            'SELECT EXISTS(SELECT 1 FROM site_settings WHERE key = $1) AS exists',
            [key,],
        );
        return r.rows[0]?.exists ?? false;
    }

    async set(key: string, value: string,): Promise<void> {
        await this.pool.query(
            `INSERT INTO site_settings (key, value)
             VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, value,],
        );
    }

    async setMany(entries: Record<string, string>,): Promise<void> {
        for (const [k, v,] of Object.entries(entries,)) {
            await this.set(k, v,);
        }
    }
}
