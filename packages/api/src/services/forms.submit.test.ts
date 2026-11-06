import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: {}, }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./formActions', () => ({ dispatchFormAction: vi.fn(), }),);
vi.mock('./notifications', () => ({}),);

const { cleanSubmittedAnswers, missingRequiredQuestion, escapeCSV, } = await import('./forms');

describe('cleanSubmittedAnswers', () => {
    it('drops answers to unknown questions and keeps one per question (last wins)', () => {
        const out = cleanSubmittedAnswers([{ id: 'a', }, { id: 'b', },], [
            { questionId: 'a', value: '1', }, { questionId: 'x', value: 'evil', }, { questionId: 'a', value: '2', },
        ],);
        expect(out,).toEqual([{ questionId: 'a', value: '2', },],);
    },);
},);

describe('missingRequiredQuestion', () => {
    const qs = [{ id: 'a', isRequired: true, question: 'A', }, { id: 'b', isRequired: false, question: 'B', },];
    it.each([
        [[], 'a',], [[{ questionId: 'a', value: '   ', },], 'a',], [[{ questionId: 'a', value: null, },], 'a',],
        [[{ questionId: 'a', value: [], },], 'a',], [[{ questionId: 'a', value: ['', ' ',], },], 'a',],
        [[{ questionId: 'a', value: 'ok', },], null,], [[{ questionId: 'a', value: 0, },], null,], [[{ questionId: 'a', value: false, },], null,],
    ] as const)('%j → %s', (answers, want,) => {
        expect(missingRequiredQuestion(qs, answers as never,)?.id ?? null,).toBe(want,);
    },);
},);

describe('escapeCSV', () => {
    it('neutralizes spreadsheet formulas and quotes when needed', () => {
        expect(escapeCSV('=HYPERLINK("x")',),).toBe('"\'=HYPERLINK(""x"")"',);
        expect(escapeCSV('+1',),).toBe("'+1",);
        expect(escapeCSV('@SUM',),).toBe("'@SUM",);
        expect(escapeCSV('plain',),).toBe('plain',);
        expect(escapeCSV('a,b',),).toBe('"a,b"',);
        expect(escapeCSV('line\nbreak',),).toBe('"line\nbreak"',);
    },);
},);
