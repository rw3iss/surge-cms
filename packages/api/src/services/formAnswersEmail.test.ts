import { describe, expect, it, } from 'vitest';
import type { FormQuestion, } from '@sitesurge/types';
import { formAnswersEmailHtml, formAnswersText, } from './formAnswersEmail';
import { brandedMessage, } from './mail/branded';

const q = (id: string, order: number, extra: Partial<FormQuestion> = {},): FormQuestion =>
    ({ id, formId: 'f', type: 'text', question: `Q ${id}`, isRequired: false, order, ...extra, }) as FormQuestion;

describe('formAnswersEmailHtml', () => {
    const questions = [
        q('a', 0, { width: 'half', },), q('b', 1, { width: 'half', },), // one row, two columns
        q('c', 2,), // full row
        q('d', 3, { width: 'half', sectionId: 's1', },), // lone half in a section
    ];
    const answers = [
        { questionId: 'a', value: 'Ann', }, { questionId: 'b', value: '<b>x</b>', },
        { questionId: 'c', value: 'line1\nline2', },
    ];
    const html = formAnswersEmailHtml({ sections: [{ id: 's1', title: 'About you', position: 3, } as never,], }, questions, answers,);
    const rows = html.split('<tr>',).slice(1,);

    it('pairs consecutive half-width questions into one row', () => {
        expect(rows[0],).toContain('Q a',);
        expect(rows[0],).toContain('Q b',);
        expect(rows[0],).toContain('width="50%"',);
    },);
    it('gives a full-width question its own row', () => {
        expect(rows[1],).toContain('colspan="2"',);
        expect(rows[1],).toContain('line1<br>line2',);
    },);
    it('adds the section heading and escapes answers', () => {
        expect(html,).toContain('About you',);
        expect(html.indexOf('About you',),).toBeLessThan(html.indexOf('Q d',),);
        expect(html,).toContain('&lt;b&gt;x&lt;/b&gt;',);
        expect(html,).toContain('—',); // unanswered
    },);
    it('has a plain-text version', () => {
        expect(formAnswersText({ sections: [{ id: 's1', title: 'About you', position: 3, } as never,], }, questions, answers,),)
            .toBe('Q a: Ann\nQ b: <b>x</b>\nQ c: line1\nline2\n\n== About you ==\nQ d: —',);
    },);
},);

describe('brandedMessage', () => {
    it('puts the logo on top and a footer with the site name', () => {
        const html = brandedMessage('<p>Hi</p>', { siteName: 'Surge', siteUrl: 'https://s.us', logoUrl: 'https://s.us/logo.png', },);
        expect(html.indexOf('logo.png',),).toBeLessThan(html.indexOf('<p>Hi</p>',),);
        expect(html.lastIndexOf('logo.png',),).toBeGreaterThan(html.indexOf('<p>Hi</p>',),);
        expect(html,).toContain('Surge · <a href="https://s.us"',);
    },);
    it('falls back to the site name without a logo', () => {
        expect(brandedMessage('x', { siteName: 'Surge', siteUrl: '', logoUrl: null, },),).toContain('>Surge</a>',);
    },);
},);
