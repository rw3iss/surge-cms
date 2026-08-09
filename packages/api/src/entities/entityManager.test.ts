import { afterEach, describe, expect, it, } from 'vitest';
import type { EntityTypeDef, } from '@sitesurge/types';
import * as em from './entityManager';

function type(key: string,): EntityTypeDef {
    return {
        id: key, key, label: key, labelPlural: key, singularVar: key, pluralVar: key,
        origin: 'custom', internal: false, tableName: `ce_${key}`, hasSlug: true, hasStatus: false,
        searchable: false, revisioned: false, routing: {} as never, caching: {} as never,
        fields: [{ id: 'f', key: 'title', label: 'title', type: 'text', core: false, required: true,
            unique: false, indexed: false, searchable: true, position: 0, },],
        createdAt: '', updatedAt: '',
    };
}

afterEach(() => em.__setCacheForTests(null,));

describe('EntityManager', () => {
    it('throws before load()', () => {
        expect(() => em.all()).toThrow(/not loaded/,);
        expect(em.isLoaded()).toBe(false,);
    });

    it('serves cached types after load', () => {
        em.__setCacheForTests([type('recipe',), type('event',),],);
        expect(em.isLoaded()).toBe(true,);
        expect(em.all().map((t,) => t.key,).sort(),).toEqual(['event', 'recipe',],);
        expect(em.getType('recipe',)?.tableName,).toBe('ce_recipe',);
        expect(em.getField('recipe', 'title',)?.searchable,).toBe(true,);
        expect(() => em.requireType('nope',)).toThrow();
    });
});
