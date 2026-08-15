import { describe, expect, it, } from 'vitest';
import { coreDescriptors, } from './coreDescriptors';

describe('coreDescriptors', () => {
    const defs = coreDescriptors();

    it('registers the core types adopting existing tables', () => {
        expect(defs.map((d,) => d.key,).sort(),).toEqual(['campaign', 'contact', 'form', 'page', 'post', 'product', 'user',],);
        const product = defs.find((d,) => d.key === 'product',)!;
        expect(product.tableName,).toBe('shop_products',);
        expect(product.ownerFeature,).toBe('shop',);
        // The Contacts feature owns the `contact` type + its ce_contact table.
        const contact = defs.find((d,) => d.key === 'contact',)!;
        expect(contact.tableName,).toBe('ce_contact',);
        expect(contact.ownerFeature,).toBe('contacts',);
        expect(contact.internal,).toBe(true,);
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
