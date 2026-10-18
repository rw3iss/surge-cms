/**
 * Every /admin/help page must be in the help registry, or it would be missing
 * from the help index AND the "Help contents" dropdown on every help page.
 */
import { readFileSync, } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../stores/siteSettings', () => ({ isFeatureEnabled: () => true, }),);

const { TOPICS, helpGroups, } = await import('./helpTopics');

describe('help registry', () => {
    it('has an entry for every /help/* route in App.tsx', () => {
        const app = readFileSync(path.resolve(__dirname, '../../App.tsx',), 'utf8',);
        const routes = [...app.matchAll(/<Route\s+path="(\/help\/[^"]+)"/g,),].map((m,) => `/admin${m[1]}`);
        expect(routes.length,).toBeGreaterThan(5,);
        const known = new Set(TOPICS.map((t,) => t.path,),);
        expect(routes.filter((r,) => !known.has(r,)),).toEqual([],);
    },);
    it('splits into topics and developer references, every page once', () => {
        const { topics, references, } = helpGroups();
        expect(topics.length + references.length,).toBe(TOPICS.length,);
        expect(references.every((t,) => t.dev,),).toBe(true,);
    },);
},);
