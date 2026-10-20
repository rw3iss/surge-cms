/**
 * `{{ template(...) }}` and `{{ component(...) }}` — render a saved block
 * template / component INSIDE templated text. ONE mapping from the call to what
 * to look up and what data to bind, shared by the site, SSR and email runtimes
 * (each looks the template up and renders its blocks through its own pipeline).
 *
 *   {{ template('Product Card', p) }}                 entity template, record bound to its variable
 *   {{ template('Product Card', product=p) }}         the same, by name (the type's singular var, or `record=`)
 *   {{ template('Product Card', p, type='product') }} name used by several entity types → pick one
 *   {{ template('7f3c…') }}                           by id (uuid); with no record → renders unbound
 *   {{ component('Upcoming Events', events=list) }}   a named arg matching a SLOT id fills that slot
 *   {{ component('Upcoming Events', events=list, layout='column', title="What's on") }}
 *                                                     every other named arg is a PROP ({{ props.layout }})
 *
 * The first argument (or `name=` / `id=`) names the template — an id, or a
 * name (case-insensitive; `type=` narrows a template name to one entity type).
 * Arguments may come in any order; anything unexpected is ignored, never fatal.
 *
 * Results: `entityRef(TEMPLATE_KIND | COMPONENT_KIND, TemplateRenderData)`. A
 * missing template / bad argument resolves to the same ref with `error` set:
 * the site renders nothing (the admin a short notice), SSR/email render
 * nothing — the page never breaks.
 */

/** Whole-entity kind: an entity template rendered for one record (or a group). */
export const TEMPLATE_KIND = 'blockTemplate';
/** Whole-entity kind: a component rendered with slot values + props. */
export const COMPONENT_KIND = 'component';
export const TEMPLATE_FUNCTION_NAMES = ['template', 'component',] as const;

/** Deepest template-in-template nesting a render may reach (cycle / runaway guard). */
export const MAX_TEMPLATE_DEPTH = 4;

/** Reserved named args (never a slot or prop). */
const RESERVED = new Set(['name', 'id', 'type', 'record', 'entity',],);

const str = (v: unknown,): string => (v === undefined || v === null ? '' : String(v,).trim());
const isRecord = (v: unknown,): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v,);

/** What a `template()` / `component()` call asks for, before the lookup. */
export interface TemplateCall {
    kind: typeof TEMPLATE_KIND | typeof COMPONENT_KIND;
    /** Id or name of the template / component ('' = none given → error). */
    ref: string;
    /** `template()` only: narrows a name to one entity type. */
    entityType?: string;
    /** `template()` only: the record(s) passed positionally or as `record=` / `entity=`. */
    record?: unknown;
    /** Every named arg that is not reserved (slots + props, or the singular-var form). */
    named: Record<string, unknown>;
}

/** Parse a call's arguments (any order; positional: ref, then record). */
export function templateCallFor(
    name: string,
    args: unknown[],
    named: Record<string, unknown> | undefined,
): TemplateCall {
    const kind = name === 'component' ? COMPONENT_KIND : TEMPLATE_KIND;
    const n = named ?? {};
    const positional = [...args,];
    // The ref: `name=` / `id=` win, else the first string positional.
    let ref = str(n.id,) || str(n.name,);
    if (!ref) {
        const i = positional.findIndex((a,) => typeof a === 'string');
        if (i >= 0) ref = str(positional.splice(i, 1,)[0],);
    }
    const rest: Record<string, unknown> = {};
    for (const [k, v,] of Object.entries(n,)) if (!RESERVED.has(k,)) rest[k] = v;
    const call: TemplateCall = { kind, ref, named: rest, };
    if (kind === TEMPLATE_KIND) {
        const t = str(n.type,);
        if (t) call.entityType = t;
        // The record: `record=` / `entity=`, else the first non-string positional.
        const rec = n.record ?? n.entity ?? positional.find((a,) => isRecord(a,) || Array.isArray(a,));
        if (rec !== undefined) call.record = rec;
    }
    return call;
}

/** A slot as the call needs it (id + whether it holds many). */
export interface TemplateCallSlot { id: string; array: boolean; }

/**
 * Split a component call's named args into SLOT values (keyed by slot id) and
 * PROPS (everything else, stringified). A slot value is normalised to the
 * slot's shape: an array slot gets an array (one record → [record]), a single
 * slot gets one record (an array → its first item). Non-object items are dropped.
 */
export function componentArgsFor(
    slots: TemplateCallSlot[],
    named: Record<string, unknown>,
): { values: Record<string, unknown>; props: Record<string, string>; } {
    const byId = new Map(slots.map((s,) => [s.id, s,]),);
    const values: Record<string, unknown> = {};
    const props: Record<string, string> = {};
    for (const [k, v,] of Object.entries(named,)) {
        const slot = byId.get(k,);
        if (slot) {
            const list = (Array.isArray(v,) ? v : v == null ? [] : [v,]).map(unwrapRecord,).filter(isRecord,);
            values[k] = slot.array ? list : (list[0] ?? null);
        } else if (v !== undefined && v !== null && typeof v !== 'object') {
            props[k] = String(v,);
        }
    }
    return { values, props, };
}

/**
 * The record a `template()` call binds, given the template's variable names:
 * `record=` / positional, else a named arg equal to the singular var
 * (`product=p`). A list template takes an array (or wraps one record).
 */
export function templateRecordFor(
    call: TemplateCall,
    vars: { singularVar?: string; pluralVar?: string; mode?: 'single' | 'list'; },
): { record: Record<string, unknown> | null; records: Record<string, unknown>[]; } {
    const raw = call.record
        ?? (vars.singularVar ? call.named[vars.singularVar] : undefined)
        ?? (vars.pluralVar ? call.named[vars.pluralVar] : undefined);
    const list = (Array.isArray(raw,) ? raw : raw == null ? [] : [raw,]).map(unwrapRecord,).filter(isRecord,);
    return { record: list[0] ?? null, records: list, };
}

/** A `{{ }}` entity ref (`{ __entity, data }`) passed as an argument → its plain record. */
function unwrapRecord(v: unknown,): unknown {
    if (isRecord(v,) && v.__entity === true) return v.data;
    return v;
}

/** The data a TEMPLATE_KIND / COMPONENT_KIND ref carries to a renderer. */
export interface TemplateRenderData {
    /** The resolved template / component (absent when `error`). */
    templateId?: string;
    templateName?: string;
    /** Entity type of an entity template (null for a component). */
    entityType?: string | null;
    /** template(): the bound record + (list templates) every record. */
    record?: Record<string, unknown> | null;
    records?: Record<string, unknown>[];
    /** component(): slot id → record(s), and the props. */
    values?: Record<string, unknown>;
    props?: Record<string, string>;
    /** Pre-rendered HTML (server runtimes only — SSR / email). */
    html?: string;
    /** Why nothing renders ("not found", "is a component — use component()"). */
    error?: string;
}

/** The admin-facing notice for a failed call (the site shows nothing). */
export function templateCallError(call: Pick<TemplateCall, 'kind' | 'ref'>, reason: string,): string {
    const fn = call.kind === COMPONENT_KIND ? 'component' : 'template';
    return `{{ ${fn}(${call.ref ? `'${call.ref}'` : ''}) }}: ${reason}`;
}
