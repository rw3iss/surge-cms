/**
 * Field-key humanising for the entity picker's dropdowns.
 *
 * Core entity types were seeded with `label === key`, so the sort and filter
 * dropdowns listed `publishedAt` / `featuredImage` straight from the schema,
 * beside properly-titled entries like "Date created". This is the fallback that
 * closes that gap — a field WITH a real label still keeps it.
 */
import { describe, expect, it, } from 'vitest';
import { humaniseKey, } from './humaniseKey';

describe('humaniseKey', () => {
    it('splits camelCase', () => {
        expect(humaniseKey('publishedAt',),).toBe('Published at',);
        expect(humaniseKey('featuredImage',),).toBe('Featured image',);
    },);

    it('splits snake_case and kebab-case', () => {
        expect(humaniseKey('is_featured',),).toBe('Is featured',);
        expect(humaniseKey('meta-description',),).toBe('Meta description',);
    },);

    it('keeps an acronym intact', () => {
        // "Meta url title" reads worse than the key it replaced, so an all-caps
        // run is left alone rather than title-cased.
        expect(humaniseKey('metaURLTitle',),).toBe('Meta URL title',);
    },);

    it('separates a digit from the word after it', () => {
        expect(humaniseKey('option1Name',),).toBe('Option1 name',);
    },);

    it('leaves an already-plain key alone', () => {
        expect(humaniseKey('title',),).toBe('Title',);
    },);

    it('never returns empty for a key it cannot split', () => {
        // A label of "" would render as a blank dropdown row with no way to
        // tell which field it is.
        expect(humaniseKey('_',),).toBe('_',);
        expect(humaniseKey('',),).toBe('',);
    },);
},);
