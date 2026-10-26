/**
 * A form submission's answers as EMAIL HTML (and plain text), laid out like
 * the form itself: questions in display order, each section as a heading with
 * a little space above it, and field WIDTHS kept — two consecutive half-width
 * questions share a row (one equal column each), a full-width question gets
 * its own row (a lone half-width one keeps its half). Table-based, inline
 * styles; every value is escaped (answers are visitor input).
 *
 * Used by the form "email" action (`formActions.ts`), the admin notification
 * (`forms.ts` → `notifyWith('form_submission')`) and `{{answersHtml}}` /
 * `{{submission.answersHtml}}` in custom templates.
 */
import type { FormQuestion, FormSection, } from '@sitesurge/types';
import { formatAnswerValue, formLayoutItems, } from '@sitesurge/types';
import { escapeHtml, } from '../utils/html';

interface SubmittedAnswer { questionId: string; value: unknown; }

const FONT = 'font-family:Arial,Helvetica,sans-serif;';
const LABEL = `${FONT}margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#6b7280;`;
const VALUE = `${FONT}margin:0;font-size:15px;line-height:1.5;color:#111827;word-break:break-word;`;

function answerOf(q: FormQuestion, answers: SubmittedAnswer[],): string {
    return formatAnswerValue(answers.find((a,) => a.questionId === q.id,)?.value,).trim();
}

function cell(q: FormQuestion | null, answers: SubmittedAnswer[], width: '50%' | '100%',): string {
    const span = width === '100%' ? ' colspan="2"' : '';
    if (!q) return `<td width="${width}" style="width:${width};padding:0"></td>`;
    const v = answerOf(q, answers,);
    const value = v
        ? escapeHtml(v,).replace(/\r?\n/g, '<br>',)
        : '<span style="color:#9ca3af">—</span>';
    return `<td${span} width="${width}" valign="top" style="width:${width};padding:10px 8px;border-bottom:1px solid #f0f0f2">`
        + `<p style="${LABEL}">${escapeHtml(q.question,)}</p><p style="${VALUE}">${value}</p></td>`;
}

/** Questions → table rows: half + half share a row, everything else its own. */
function questionRows(questions: FormQuestion[], answers: SubmittedAnswer[],): string {
    let html = '';
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const next = questions[i + 1];
        if (q.width === 'half') {
            const pair = next?.width === 'half' ? next : null;
            if (pair) i++;
            html += `<tr>${cell(q, answers, '50%',)}${cell(pair, answers, '50%',)}</tr>`;
        } else {
            html += `<tr>${cell(q, answers, '100%',)}</tr>`;
        }
    }
    return html;
}

function table(rows: string,): string {
    return rows
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed"><colgroup><col width="50%"><col width="50%"></colgroup>${rows}</table>`
        : '';
}

function sortQuestions(questions: FormQuestion[],): FormQuestion[] {
    return questions.slice().sort((a, b,) => a.order - b.order,);
}

/** The answers, laid out like the form (sections + widths), as email HTML. */
export function formAnswersEmailHtml(
    form: { sections?: FormSection[] | null; },
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
): string {
    const items = formLayoutItems(sortQuestions(questions,), form.sections,);
    let out = '';
    let run: FormQuestion[] = [];
    const flush = () => {
        out += table(questionRows(run, answers,),);
        run = [];
    };
    for (const it of items) {
        if (it.kind === 'question') {
            run.push(it.question,);
            continue;
        }
        flush();
        const s = it.section;
        out += `<div style="margin:24px 0 4px;padding:0 8px 6px;border-bottom:2px solid #e5e7eb">`
            + (s.title ? `<p style="${FONT}margin:0;font-size:16px;font-weight:700;color:#111827">${escapeHtml(s.title,)}</p>` : '')
            + (s.description ? `<p style="${FONT}margin:4px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(s.description,)}</p>` : '')
            + `</div>`;
        out += table(questionRows(it.questions, answers,),);
    }
    flush();
    return out;
}

/** Plain-text version: `Question: answer` lines, sections as `== Title ==`. */
export function formAnswersText(
    form: { sections?: FormSection[] | null; },
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
): string {
    const line = (q: FormQuestion,) => `${q.question}: ${answerOf(q, answers,) || '—'}`;
    const lines: string[] = [];
    for (const it of formLayoutItems(sortQuestions(questions,), form.sections,)) {
        if (it.kind === 'question') lines.push(line(it.question,),);
        else lines.push('', `== ${it.section.title || 'Section'} ==`, ...it.questions.map(line,),);
    }
    return lines.join('\n',).trim();
}
