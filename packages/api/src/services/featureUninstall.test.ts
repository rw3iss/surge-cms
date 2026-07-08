import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queries: string[] = [];
const client = {
    query: vi.fn(async (sql: string,) => { queries.push(sql,); return { rows: [], }; },),
    release: vi.fn(),
};
vi.mock('../db/client', () => ({ getPool: () => ({ connect: async () => client, }), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: { invalidateSettingsCache: vi.fn(), }, }),);

import { FEATURE_REGISTRY, } from '../features/registry';
import { uninstallFeature, UninstallError, } from './featureUninstall';

const ctx = { userId: 'u', ipAddress: '', userAgent: '', };

describe('uninstallFeature', () => {
    beforeEach(() => { queries.length = 0; client.query.mockClear(); },);

    it('rejects a feature with no owned tables', async () => {
        await expect(uninstallFeature('posts' as never, ctx,),).rejects.toBeInstanceOf(UninstallError,);
    },);

    it('drops tables in reverse order + deletes migration rows + settings + commits', async () => {
        (FEATURE_REGISTRY as Record<string, unknown>).__u = {
            key: '__u', label: 'U', defaultEnabled: false,
            tables: ['a', 'b', 'c',], settingsKeys: ['__u_config',],
        };
        await uninstallFeature('__u' as never, ctx,);
        const joined = queries.join('\n',);
        expect(joined,).toContain('BEGIN',);
        // reverse order: c, b, a
        expect(joined.indexOf('DROP TABLE IF EXISTS c'),).toBeLessThan(joined.indexOf('DROP TABLE IF EXISTS b'),);
        expect(joined.indexOf('DROP TABLE IF EXISTS b'),).toBeLessThan(joined.indexOf('DROP TABLE IF EXISTS a'),);
        expect(joined,).toContain('DELETE FROM schema_migrations WHERE feature',);
        expect(joined,).toContain('DELETE FROM site_settings WHERE key',);
        expect(joined,).toContain('COMMIT',);
        delete (FEATURE_REGISTRY as Record<string, unknown>).__u;
    },);
},);
