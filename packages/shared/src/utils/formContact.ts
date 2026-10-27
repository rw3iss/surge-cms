/**
 * Who filled in a form — ONE rule for reading the submitter's email / name /
 * phone out of any form's answers (mailing-list subscribe action, the form
 * email action, replies, membership applications → the /join prefill).
 *
 * Per field, in order:
 *   1. the question's explicit **Contact field** (`FormQuestion.contactField`,
 *      set in the form editor — "Your work address" can be marked Email);
 *   2. for email, a question of type `email`;
 *   3. a loose match on the question label ("Email address", "First name
 *      (optional)", "Mobile number" …) — `guessContactField`.
 * `name` falls back to first + last name.
 */

export type FormContactField = 'email' | 'name' | 'first_name' | 'last_name' | 'phone';

export const FORM_CONTACT_FIELDS: readonly { value: FormContactField; label: string; }[] = [
    { value: 'email', label: 'Email', },
    { value: 'name', label: 'Full name', },
    { value: 'first_name', label: 'First name', },
    { value: 'last_name', label: 'Last name', },
    { value: 'phone', label: 'Phone', },
];

export function isFormContactField(v: unknown,): v is FormContactField {
    return FORM_CONTACT_FIELDS.some((f,) => f.value === v);
}

/** The contact field a label (+ question type) most likely means, or null. */
export function guessContactField(label: string | null | undefined, type?: string | null,): FormContactField | null {
    if (type === 'email') return 'email';
    // "First name (optional)" → "first name"; underscores / dashes as spaces.
    const l = String(label ?? '',).toLowerCase().replace(/\(.*?\)/g, ' ',).replace(/[_\-*:?]+/g, ' ',).replace(/\s+/g, ' ',).trim();
    if (!l) return null;
    if (/\b(e ?mail)\b/.test(l,)) return 'email';
    if (type === 'phone' || /\b(phone|mobile|cell|telephone|tel)\b/.test(l,)) return 'phone';
    if (/\b(first|given|fore) ?name\b/.test(l,)) return 'first_name';
    if (/\b(last|family|sur) ?name\b|\bsurname\b/.test(l,)) return 'last_name';
    if (/^(your |full |display )?name$|\bfull name\b/.test(l,)) return 'name';
    return null;
}

export interface FormContactQuestion {
    id: string;
    /** The question text (`FormQuestion.question`) — or `label`. */
    question?: string;
    label?: string;
    type?: string | null;
    contactField?: FormContactField | null;
}
export interface FormContactAnswer {
    questionId: string;
    value: unknown;
}

export interface FormContact {
    email: string | null;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
}

const text = (v: unknown,): string => (Array.isArray(v,) ? v.join(', ',) : v === null || v === undefined ? '' : String(v,)).trim();

/** The question each contact field reads from (explicit → type → label). */
export function contactQuestions<Q extends FormContactQuestion>(questions: readonly Q[],): Partial<Record<FormContactField, Q>> {
    const out: Partial<Record<FormContactField, Q>> = {};
    for (const q of questions) {
        if (isFormContactField(q.contactField,) && !out[q.contactField]) out[q.contactField] = q;
    }
    for (const q of questions) {
        if (q.contactField) continue; // explicitly mapped questions are not guessed again
        const guess = guessContactField(q.question ?? q.label, q.type,);
        if (guess && !out[guess]) out[guess] = q;
    }
    return out;
}

/** The submitter's contact details from a form's answers. */
export function formContactValues(questions: readonly FormContactQuestion[], answers: readonly FormContactAnswer[],): FormContact {
    const by = contactQuestions(questions,);
    const value = (f: FormContactField,): string | null => {
        const q = by[f];
        if (!q) return null;
        return text(answers.find((a,) => a.questionId === q.id)?.value,) || null;
    };
    const firstName = value('first_name',);
    const lastName = value('last_name',);
    return {
        email: value('email',),
        name: value('name',) ?? ([firstName, lastName,].filter(Boolean,).join(' ',) || null),
        firstName,
        lastName,
        phone: value('phone',),
    };
}

/** Contact details from a labelled answers SNAPSHOT (`{ label, value, field? }`,
 *  e.g. a membership application): the recorded field first, else the label. */
export function snapshotContactValues(answers: readonly { label: string; value: string; field?: FormContactField | null; }[],): FormContact {
    return formContactValues(
        answers.map((a, i,) => ({ id: String(i,), question: a.label, contactField: a.field ?? null, })),
        answers.map((a, i,) => ({ questionId: String(i,), value: a.value, })),
    );
}
