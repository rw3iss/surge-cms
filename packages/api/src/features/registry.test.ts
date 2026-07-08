import { describe, expect, it, } from 'vitest';
import { FEATURE_REGISTRY, getUninstallableTables, isUninstallable, } from './registry';

describe('feature registry lifecycle metadata', () => {
    it('features without a tables list are not uninstallable', () => {
        expect(isUninstallable('posts',),).toBe(false,);
    },);
    it('getUninstallableTables returns [] for a non-table feature', () => {
        expect(getUninstallableTables('posts',),).toEqual([],);
    },);
},);
