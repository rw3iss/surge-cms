import { describe, expect, it, } from 'vitest';
import { collectAll, deriveColumns, humanize, } from './dataset';
import { csvCell, csvLine, renderPrintHtml, } from './formats';

describe('csv', () => {
    it('quotes per RFC 4180', () => {
        expect(csvLine(['a', 'b,c', 'say "hi"', 'x\ny', null, 5,],),).toBe('a,"b,c","say ""hi""","x\ny",,5\r\n',);
    },);
    it('neutralises spreadsheet formulas', () => {
        expect(csvCell('=HYPERLINK("x")',),).toBe(`"'=HYPERLINK(""x"")"`,);
        expect(csvCell('+1',),).toBe("'+1",);
        expect(csvCell('-5',),).toBe("'-5",);
        expect(csvCell('@SUM',),).toBe("'@SUM",);
        expect(csvCell('plain',),).toBe('plain',);
    },);
    it('serialises dates and objects', () => {
        expect(csvCell(new Date('2026-01-02T03:04:05Z',),),).toBe('2026-01-02T03:04:05.000Z',);
        expect(csvCell({ a: 1, },),).toBe('"{""a"":1}"',);
    },);
},);

describe('columns', () => {
    it('derives from the data: preferred first, then first-seen, omitting listed keys', () => {
        const cols = deriveColumns([{ b: 1, a: 2, secret: 'x', }, { c: 3, a: 4, },], { preferred: ['a', 'zz',], omit: ['secret',], },);
        expect(cols.map((c,) => c.key,),).toEqual(['a', 'b', 'c',],);
    },);
    it('labels', () => {
        expect(humanize('firstName',),).toBe('First Name',);
        expect(humanize('user_id',),).toBe('User ID',);
    },);
},);

describe('collectAll', () => {
    it('walks every page of the list function', async () => {
        const all = Array.from({ length: 23, }, (_x, i,) => ({ i, }),);
        const rows = await collectAll(async (page, limit,) => ({ rows: all.slice((page - 1) * limit, page * limit,), total: all.length, }), 10,);
        expect(rows.map((r,) => r.i,),).toEqual(all.map((r,) => r.i,),);
    },);
},);

describe('print', () => {
    it('renders the basic columns, escaped, with a count', () => {
        const html = renderPrintHtml({
            title: 'Donors', columns: [{ key: 'name', label: 'Name', }, { key: 'note', label: 'Note', },], printColumns: ['name',],
            rows: [{ name: '<b>Ann</b>', note: 'x', },],
        }, { siteName: 'Site', },);
        expect(html,).toContain('&lt;b&gt;Ann&lt;/b&gt;',);
        expect(html,).not.toContain('<th>Note</th>',);
        expect(html,).toContain('1 record',);
    },);
},);

