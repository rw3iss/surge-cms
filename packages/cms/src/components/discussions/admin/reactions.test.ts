import { describe, expect, it, } from 'vitest';
import { parseReactions, } from './reactions';

describe('parseReactions', () => {
    it('splits on spaces and commas, de-duplicates, keeps order', () => {
        expect(parseReactions(' 👍 ❤️,😂  👍 ',),).toEqual(['👍', '❤️', '😂',],);
    },);
    it('empty text → no reactions', () => expect(parseReactions('  , ',),).toEqual([],));
},);
