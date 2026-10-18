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
    it('never lets a save overwrite server-managed live keys (S2)', () => {
        const existing = {
            chatMode: 'public',
            recordingVersions: [{ mediaId: 'a', }, { mediaId: 'b', },],
            recordingMediaId: 'b',
            recordingRemovedAt: null,
            providerInputId: 'inp-1',
        };
        // A stale editor copy (from before recording `b` completed).
        const stale = { chatMode: 'members', recordingVersions: [{ mediaId: 'a', },], recordingMediaId: 'a', providerInputId: null, };
        const out = resolveTypeSettings('live', stale, existing,);
        expect(out.chatMode,).toBe('members',);
        expect(out.recordingVersions,).toEqual(existing.recordingVersions,);
        expect(out.recordingMediaId,).toBe('b',);
        expect(out.providerInputId,).toBe('inp-1',);
    },);
},);
