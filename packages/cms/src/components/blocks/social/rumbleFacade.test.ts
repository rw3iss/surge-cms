import { describe, expect, it, } from 'vitest';
import { rumbleEmbedId, rumbleEmbedSrc, rumbleFacadeLabel, } from './rumbleFacade';

describe('rumbleFacade', () => {
    it('derives the player id from the numeric video id', () => {
        expect(rumbleEmbedId('449778068',),).toBe('v7fsaz8',);
        expect(rumbleEmbedId('nope',),).toBeNull();
        expect(rumbleEmbedId('0',),).toBeNull();
    },);
    it('prefers a stored embed id when it looks right', () => {
        expect(rumbleEmbedId('1', 'vabc123',),).toBe('vabc123',);
        expect(rumbleEmbedId('449778068', 'v"><x',),).toBe('v7fsaz8',);
    },);
    it('builds the player URL and label', () => {
        expect(rumbleEmbedSrc('v7fsaz8',),).toBe('https://rumble.com/embed/v7fsaz8/?autoplay=2',);
        expect(rumbleFacadeLabel(undefined,),).toBe('Rumble video',);
        expect(rumbleFacadeLabel('  a\n b ',),).toBe('a b',);
    },);
},);
