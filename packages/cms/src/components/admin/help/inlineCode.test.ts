import { describe, expect, it, } from 'vitest';
import { splitInline, } from './inlineCode';

describe('splitInline', () => {
    it('splits code and bold runs', () => {
        expect(splitInline('Use `cms.posts` for **all** posts',),).toEqual([
            { kind: 'text', text: 'Use ', },
            { kind: 'code', text: 'cms.posts', },
            { kind: 'text', text: ' for ', },
            { kind: 'bold', text: 'all', },
            { kind: 'text', text: ' posts', },
        ],);
    },);
    it('leaves an unmatched backtick or ** as typed', () => {
        expect(splitInline('a `b',),).toEqual([{ kind: 'text', text: 'a `b', },],);
        expect(splitInline('a **b',),).toEqual([{ kind: 'text', text: 'a **b', },],);
    },);
    it('does not bold inside a code span', () => {
        expect(splitInline('`**x**`',),).toEqual([{ kind: 'code', text: '**x**', },],);
    },);
},);
