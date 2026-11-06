import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(), getClient: vi.fn(), }),);

import type { Plugin, } from '@sitesurge/types';
import { dropEchoedSecrets, maskPluginSecrets, PLUGIN_SECRET_MASK, } from './plugins';

const manifest = {
    name: 'p', version: '1', configSchema: [
        { key: 'token', label: 'Token', type: 'secret', },
        { key: 'url', label: 'URL', type: 'string', secret: true, },
    ],
} as unknown as Plugin['manifest'];

describe('plugin config secrets', () => {
    it('masks set type:secret values only (secret:true fields stay editable)', () => {
        const p = { name: 'p', manifest, config: { token: 'abc', url: 'http://x', }, } as unknown as Plugin;
        expect(maskPluginSecrets(p,).config,).toEqual({ token: PLUGIN_SECRET_MASK, url: 'http://x', },);
        const empty = { ...p, config: { token: '', }, } as unknown as Plugin;
        expect(maskPluginSecrets(empty,).config.token,).toBe('',);
    },);

    it('an echoed mask on save keeps the stored secret; a new value or a clear goes through', () => {
        expect(dropEchoedSecrets(manifest, { token: PLUGIN_SECRET_MASK, url: 'u', },),).toEqual({ url: 'u', },);
        expect(dropEchoedSecrets(manifest, { token: 'new', },),).toEqual({ token: 'new', },);
        expect(dropEchoedSecrets(manifest, { token: '', },),).toEqual({ token: '', },);
    },);
});
