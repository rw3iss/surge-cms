import { describe, expect, it, } from 'vitest';
import {
    cleanFormSections, dropFormRow, dropFormRowAtEnd, type FormSectionRow, formLayoutFromRows, formLayoutItems, formRowsFromLayout, isFormSectionRow, moveFormRow, normalizeFormRows,
    removeFormSection,
} from './formSections';

type Q = { id: string; sectionId?: string | null; };
const q = (id: string, sectionId: string | null = null,): Q => ({ id, sectionId, });
const S = (id: string,): FormSectionRow => ({ kind: 'section', id, title: id, description: '', align: 'left', });
const ids = (rows: Array<Q | FormSectionRow>,) => rows.map((r,) => isFormSectionRow(r,) ? `[${r.id}]` : `${r.id}${r.sectionId ? `@${r.sectionId}` : ''}`,).join(' ',);

describe('formLayoutItems', () => {
    it('places sections by position, groups their questions, keeps orphans at the root', () => {
        const items = formLayoutItems([q('a',), q('b', 's1',), q('c', 's1',), q('d', 'gone',), q('e',),], [
            { id: 's1', title: 'One', position: 1, },
            { id: 's2', title: 'Empty', position: 5, },
        ],);
        expect(items.map((i,) => i.kind === 'section' ? `[${i.section.id}:${i.questions.map((x,) => x.id,).join(',',)}]` : i.question.id,),)
            .toEqual(['a', '[s1:b,c]', 'd', 'e', '[s2:]',],);
    },);
    it('no sections = the questions as they are', () => {
        expect(formLayoutItems([q('a',), q('b',),], [],).map((i,) => i.kind,),).toEqual(['question', 'question',],);
    },);
});

describe('rows ↔ layout', () => {
    it('round-trips; sections get position = questions before them', () => {
        const rows = [q('a',), S('s1',), q('b', 's1',), q('c', 's1',), q('d',), S('s2',),];
        const { questions, sections, } = formLayoutFromRows(rows,);
        expect(questions.map((x,) => x.id,),).toEqual(['a', 'b', 'c', 'd',],);
        expect(sections.map((s,) => [s.id, s.position,],),).toEqual([['s1', 1,], ['s2', 4,],],);
        expect(ids(formRowsFromLayout(questions, sections,),),).toBe(ids(rows,),);
    },);
    it('normalize: a section\'s questions follow it; a missing section returns its questions to the root', () => {
        expect(ids(normalizeFormRows([S('s1',), q('a',), q('b', 's1',), q('c', 'x',),],),),).toBe('[s1] b@s1 a c');
    },);
});

describe('moveFormRow', () => {
    const rows = [q('a',), S('s1',), q('b', 's1',), q('c', 's1',), q('d',),];
    it('a root question jumps over a whole section', () => {
        expect(ids(moveFormRow(rows, 0, 'down',),),).toBe('[s1] b@s1 c@s1 a d');
    },);
    it('a question moves within its section only', () => {
        expect(ids(moveFormRow(rows, 3, 'up',),),).toBe('a [s1] c@s1 b@s1 d');
        expect(ids(moveFormRow(rows, 3, 'down',),),).toBe(ids(rows,),);
    },);
    it('a section moves with its questions', () => {
        expect(ids(moveFormRow(rows, 1, 'down',),),).toBe('a d [s1] b@s1 c@s1');
    },);
});

describe('dropFormRow', () => {
    const rows = [q('a',), S('s1',), q('b', 's1',), q('c',), S('s2',),];
    it('a question dropped after a section header joins it at the top', () => {
        expect(ids(dropFormRow(rows, 0, 1, true,),),).toBe('[s1] a@s1 b@s1 c [s2]');
        expect(ids(dropFormRow(rows, 3, 4, true,),),).toBe('a [s1] b@s1 [s2] c@s2');
    },);
    it('before a section header = the root, above it', () => {
        expect(ids(dropFormRow(rows, 2, 1, false,),),).toBe('a b [s1] c [s2]');
    },);
    it('next to a question = that question\'s section', () => {
        expect(ids(dropFormRow(rows, 3, 2, false,),),).toBe('a [s1] c@s1 b@s1 [s2]');
        expect(ids(dropFormRow(rows, 2, 3, true,),),).toBe('a [s1] c b [s2]');
    },);
    it('a section moves with its questions among the root units', () => {
        expect(ids(dropFormRow(rows, 1, 0, false,),),).toBe('[s1] b@s1 a c [s2]');
        expect(ids(dropFormRow(rows, 1, 4, true,),),).toBe('a c [s2] [s1] b@s1');
        // A target inside another section = that section.
        const r2 = [S('s1',), q('a', 's1',), S('s2',), q('b', 's2',),];
        expect(ids(dropFormRow(r2, 2, 1, false,),),).toBe('[s2] b@s2 [s1] a@s1');
    },);
});

describe('removeFormSection', () => {
    const rows = [S('s1',), q('a', 's1',), q('b',),];
    it('delete takes its questions; keep moves them to the root in place', () => {
        expect(ids(removeFormSection(rows, 's1', 'delete',),),).toBe('b');
        expect(ids(removeFormSection(rows, 's1', 'keep',),),).toBe('a b');
    },);
});

describe('cleanFormSections', () => {
    it('known keys, unique ids, bounded', () => {
        expect(cleanFormSections([{ id: 'x', title: 'T', align: 'bogus', position: -3, extra: 1, }, { id: 'x', }, { title: 'no id', },],),)
            .toEqual([{ id: 'x', title: 'T', description: null, align: 'left', position: 0, },],);
        expect(cleanFormSections('nope',),).toEqual([],);
    },);
});

describe('dropFormRowAtEnd', () => {
    const rows = [S('s1',), q('a', 's1',), q('b',),];
    it('a question leaves its section; a section moves last with its questions', () => {
        expect(ids(dropFormRowAtEnd(rows, 1,),),).toBe('[s1] b a');
        expect(ids(dropFormRowAtEnd(rows, 0,),),).toBe('b [s1] a@s1');
    },);
});
