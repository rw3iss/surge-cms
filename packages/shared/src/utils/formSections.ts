/**
 * Form SECTIONS — headings that group questions (one level deep).
 *
 * Storage keeps every existing consumer working:
 *   - a question's `order` stays ONE sequence across the whole form, in display
 *     order (submission tables, CSV export, notification emails sort by it);
 *   - a question carries `sectionId` (null = not in a section);
 *   - a section (`forms.sections` JSON array) carries `position` = how many
 *     questions come before it, which also places an empty section.
 *
 * `formLayoutItems` turns that into the render list every surface uses (the
 * public FormRenderer, the admin preview), and `formRowsFromLayout` /
 * `formLayoutFromRows` convert to and from the editor's flat row list.
 */

export type FormSectionAlign = 'left' | 'center' | 'right';
export const FORM_SECTION_ALIGNS: readonly FormSectionAlign[] = ['left', 'center', 'right',];

export interface FormSection {
    /** Stable id (client-generated); questions reference it as `sectionId`. */
    id: string;
    title: string;
    /** Shown under the title; omitted when empty. */
    description?: string | null;
    /** Title + description alignment (default left). */
    align?: FormSectionAlign | null;
    /** Number of questions (in the overall order) before this section. */
    position: number;
}

/** The minimum a question needs here. */
export interface SectionedQuestion {
    sectionId?: string | null;
}

export type FormLayoutItem<Q,> =
    | { kind: 'section'; section: FormSection; questions: Q[]; }
    | { kind: 'question'; question: Q; };

/**
 * Questions (already in their overall `order`) + sections → the display list:
 * root questions and sections in place, each section holding its questions.
 * A question pointing at a missing section shows at the root; sections keep
 * their array order when they share a position.
 */
export function formLayoutItems<Q extends SectionedQuestion,>(questions: Q[], sections: FormSection[] | null | undefined,): FormLayoutItem<Q>[] {
    const list = (sections ?? []).filter((s,) => s && typeof s.id === 'string' && s.id,);
    const ids = new Set(list.map((s,) => s.id,),);
    const children = new Map<string, Q[]>(list.map((s,) => [s.id, [],],),);
    for (const q of questions) if (q.sectionId && ids.has(q.sectionId,)) children.get(q.sectionId,)!.push(q,);
    const out: FormLayoutItem<Q>[] = [];
    const placed = new Set<string>();
    const emitSectionsUpTo = (k: number,) => {
        for (const s of list) {
            if (placed.has(s.id,) || !(Number(s.position,) <= k)) continue;
            placed.add(s.id,);
            out.push({ kind: 'section', section: s, questions: children.get(s.id,)!, },);
        }
    };
    questions.forEach((q, k,) => {
        emitSectionsUpTo(k,);
        if (!(q.sectionId && ids.has(q.sectionId,))) out.push({ kind: 'question', question: q, },);
    },);
    emitSectionsUpTo(Number.POSITIVE_INFINITY,);
    return out;
}

/** A section row in the editor's flat list. */
export interface FormSectionRow {
    kind: 'section';
    id: string;
    title: string;
    description: string;
    align: FormSectionAlign;
}

export const isFormSectionRow = (r: unknown,): r is FormSectionRow =>
    !!r && typeof r === 'object' && (r as { kind?: unknown; }).kind === 'section';

/** Layout → the editor's flat rows: each section row followed by its questions. */
export function formRowsFromLayout<Q extends SectionedQuestion,>(questions: Q[], sections: FormSection[] | null | undefined,): Array<Q | FormSectionRow> {
    const rows: Array<Q | FormSectionRow> = [];
    for (const item of formLayoutItems(questions, sections,)) {
        if (item.kind === 'question') {
            rows.push({ ...item.question, sectionId: null, },);
        } else {
            const s = item.section;
            rows.push({ kind: 'section', id: s.id, title: s.title ?? '', description: s.description ?? '', align: s.align ?? 'left', },);
            for (const q of item.questions) rows.push({ ...q, sectionId: s.id, },);
        }
    }
    return rows;
}

/**
 * The editor's flat rows → what is saved: questions in display order (their
 * index is the overall `order`) with `sectionId`, and sections with `position`.
 * Rows are normalized first (see `normalizeFormRows`).
 */
export function formLayoutFromRows<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>,): { questions: Q[]; sections: FormSection[]; } {
    const questions: Q[] = [];
    const sections: FormSection[] = [];
    for (const r of normalizeFormRows(rows,)) {
        if (isFormSectionRow(r,)) {
            sections.push({ id: r.id, title: r.title, description: r.description.trim() || null, align: r.align, position: questions.length, },);
        } else {
            questions.push(r,);
        }
    }
    return { questions, sections, };
}

/**
 * Keep the flat rows consistent: every section's questions directly follow it
 * (in their current relative order), root questions stay where they are, and
 * a question whose section no longer exists returns to the root.
 */
export function normalizeFormRows<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>,): Array<Q | FormSectionRow> {
    const ids = new Set(rows.filter(isFormSectionRow,).map((s,) => s.id,),);
    const kids = new Map<string, Q[]>();
    for (const r of rows) {
        if (isFormSectionRow(r,)) continue;
        const sid = r.sectionId && ids.has(r.sectionId,) ? r.sectionId : null;
        if (sid) {
            if (!kids.has(sid,)) kids.set(sid, [],);
            kids.get(sid,)!.push(r,);
        }
    }
    const out: Array<Q | FormSectionRow> = [];
    for (const r of rows) {
        if (isFormSectionRow(r,)) {
            out.push(r, ...(kids.get(r.id,) ?? []),);
        } else if (!(r.sectionId && ids.has(r.sectionId,))) {
            out.push(r.sectionId ? { ...r, sectionId: null, } : r,);
        }
    }
    return out;
}

/** The top-level unit a row belongs to: a section (with its questions) or a root question. */
function unitBounds<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>, index: number,): [number, number,] {
    const r = rows[index];
    if (isFormSectionRow(r,)) {
        let end = index + 1;
        while (end < rows.length && !isFormSectionRow(rows[end],) && (rows[end] as Q).sectionId === r.id) end++;
        return [index, end,];
    }
    return [index, index + 1,];
}

/**
 * ↑ / ↓ on a row: a question moves among its siblings (inside its section,
 * or among the root units — a root question jumps over a whole section); a
 * section moves with all its questions among the root units.
 */
export function moveFormRow<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>, index: number, dir: 'up' | 'down',): Array<Q | FormSectionRow> {
    const r = rows[index];
    if (!r) return rows;
    const inSection = !isFormSectionRow(r,) && !!r.sectionId;
    // Sibling units, as [start, end) spans, in order.
    const spans: Array<[number, number,]> = [];
    if (inSection) {
        rows.forEach((x, i,) => { if (!isFormSectionRow(x,) && x.sectionId === (r as Q).sectionId) spans.push([i, i + 1,],); },);
    } else {
        for (let i = 0; i < rows.length;) {
            const x = rows[i];
            if (!isFormSectionRow(x,) && x.sectionId) { i++; continue; }
            const [a, b,] = unitBounds(rows, i,);
            spans.push([a, b,],);
            i = b;
        }
    }
    const at = spans.findIndex(([a,],) => a === index,);
    const to = dir === 'up' ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= spans.length) return rows;
    const [lo, hi,] = at < to ? [spans[at]!, spans[to]!,] : [spans[to]!, spans[at]!,];
    return [...rows.slice(0, lo[0],), ...rows.slice(hi[0], hi[1],), ...rows.slice(lo[1], hi[0],), ...rows.slice(lo[0], lo[1],), ...rows.slice(hi[1],),];
}

/**
 * Drag and drop: put the row at `from` before / after the row at `target`.
 *   - A QUESTION joins the target's section (a question target → its
 *     section; a section target → AFTER = the top of that section, BEFORE =
 *     the root, just above it).
 *   - A SECTION (with its questions) moves among the root units; a target
 *     inside a section counts as that section.
 */
export function dropFormRow<Q extends SectionedQuestion,>(
    rows: Array<Q | FormSectionRow>, from: number, target: number, after: boolean,
): Array<Q | FormSectionRow> {
    const dragged = rows[from];
    const t = rows[target];
    if (!dragged || !t || from === target) return rows;
    if (isFormSectionRow(dragged,)) {
        let ti = target;
        if (!isFormSectionRow(t,) && t.sectionId) ti = rows.findIndex((x,) => isFormSectionRow(x,) && x.id === t.sectionId,);
        const [ua, ub,] = unitBounds(rows, from,);
        if (ti >= ua && ti < ub) return rows;
        const [ta, tb,] = unitBounds(rows, ti,);
        const unit = rows.slice(ua, ub,);
        const rest = [...rows.slice(0, ua,), ...rows.slice(ub,),];
        const insertAt = (after ? tb : ta) - (ta >= ub ? ub - ua : 0);
        return [...rest.slice(0, insertAt,), ...unit, ...rest.slice(insertAt,),];
    }
    const sectionId = isFormSectionRow(t,) ? (after ? t.id : null) : (t.sectionId ?? null);
    const moved = { ...dragged, sectionId, } as Q;
    const rest = rows.filter((_, i,) => i !== from,);
    let ti = rest.indexOf(t,);
    if (isFormSectionRow(t,) && !after) {
        // Root, just above the section.
        return normalizeFormRows([...rest.slice(0, ti,), moved, ...rest.slice(ti,),],);
    }
    ti = after ? ti + 1 : ti;
    return normalizeFormRows([...rest.slice(0, ti,), moved, ...rest.slice(ti,),],);
}

/** Drop at the very end of the list: a question leaves its section; a section moves last (with its questions). */
export function dropFormRowAtEnd<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>, from: number,): Array<Q | FormSectionRow> {
    const dragged = rows[from];
    if (!dragged) return rows;
    if (isFormSectionRow(dragged,)) {
        const [a, b,] = unitBounds(rows, from,);
        return [...rows.slice(0, a,), ...rows.slice(b,), ...rows.slice(a, b,),];
    }
    return normalizeFormRows([...rows.filter((_, i,) => i !== from,), { ...dragged, sectionId: null, } as Q,],);
}

/** Delete a section: its questions too (`delete`), or move them to the root in place (`keep`). */
export function removeFormSection<Q extends SectionedQuestion,>(rows: Array<Q | FormSectionRow>, sectionId: string, mode: 'delete' | 'keep',): Array<Q | FormSectionRow> {
    const out: Array<Q | FormSectionRow> = [];
    for (const r of rows) {
        if (isFormSectionRow(r,)) { if (r.id !== sectionId) out.push(r,); continue; }
        if (r.sectionId === sectionId) { if (mode === 'keep') out.push({ ...r, sectionId: null, },); continue; }
        out.push(r,);
    }
    return out;
}

/** Sanitize a `sections` array from a client: known keys only, bounded lengths, unique ids. */
export function cleanFormSections(v: unknown,): FormSection[] {
    if (!Array.isArray(v,)) return [];
    const seen = new Set<string>();
    const out: FormSection[] = [];
    for (const raw of v.slice(0, 200,)) {
        if (!raw || typeof raw !== 'object') continue;
        const s = raw as Record<string, unknown>;
        const id = typeof s.id === 'string' ? s.id.trim().slice(0, 64,) : '';
        if (!id || seen.has(id,)) continue;
        seen.add(id,);
        const align = FORM_SECTION_ALIGNS.includes(s.align as FormSectionAlign,) ? s.align as FormSectionAlign : 'left';
        const description = typeof s.description === 'string' ? s.description.slice(0, 2000,) : '';
        out.push({
            id,
            title: typeof s.title === 'string' ? s.title.slice(0, 300,) : '',
            description: description.trim() ? description : null,
            align,
            position: Math.max(0, Math.trunc(Number(s.position,) || 0,),),
        },);
    }
    return out;
}
