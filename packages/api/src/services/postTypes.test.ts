import { describe, expect, it, } from 'vitest';
import { assertPostType, resolveTypeSettings, } from './postTypes';

describe('post types', () => {
    it('accepts registered keys and names the valid ones otherwise', () => {
        expect(assertPostType('video',),).toBe('video',);
        expect(() => assertPostType('podcast',)).toThrow(/Valid types: article, video, short, live, custom/,);
    },);
    it('merges settings over the type defaults (and stored settings when the type is kept)', () => {
        expect(resolveTypeSettings('live', { chatMode: 'members', },),).toMatchObject({
            archiveVideo: true, chatMode: 'members', reactionsEnabled: true,
        },);
        expect(resolveTypeSettings('live', { reactionsEnabled: false, }, { chatMode: 'off', },),).toMatchObject({
            chatMode: 'off', reactionsEnabled: false,
        },);
        expect(resolveTypeSettings('article', undefined,),).toEqual({},);
    },);
    it('validates known live keys', () => {
        expect(() => resolveTypeSettings('live', { chatMode: 'everyone', },)).toThrow(/chatMode/,);
        expect(() => resolveTypeSettings('live', { archiveVideo: 'yes', },)).toThrow(/archiveVideo/,);
        expect(() => resolveTypeSettings('live', [],)).toThrow(/object/,);
    },);
},);
