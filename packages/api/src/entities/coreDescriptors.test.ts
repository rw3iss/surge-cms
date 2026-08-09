import { describe, expect, it, } from 'vitest';
import { coreDescriptors, } from './coreDescriptors';

describe('coreDescriptors', () => {
    const defs = coreDescriptors();

    it('registers the five core types adopting existing tables', () => {
        expect(defs.map((d,) => d.key,).sort(),).toEqual(['campaign', 'form', 'page', 'post', 'user',],);
        const post = defs.find((d,) => d.key === 'post',)!;
        expect(post.origin,).toBe('core',);
        expect(post.internal,).toBe(true,);
        expect(post.tableName,).toBe('posts',);
        expect(post.singularVar,).toBe('post',);
        expect(post.pluralVar,).toBe('posts',);
        expect(post.adminEditRoute,).toBe('/admin/posts/:id',);
    });

    it('marks all core fields as core (locked) and parses enum options', () => {
        const post = defs.find((d,) => d.key === 'post',)!;
        expect(post.fields.length,).toBeGreaterThan(0,);
        expect(post.fields.every((f,) => f.core,)).toBe(true,);
        const status = post.fields.find((f,) => f.key === 'status',)!;
        expect(status.type,).toBe('enum',);
        expect(status.options?.values,).toContain('published',);
    });
});
