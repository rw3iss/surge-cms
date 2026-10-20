/**
 * Template SLOTS on the web (public site + every admin preview).
 *
 * An `entity` / `template` block that renders a template PROVIDES the
 * template's slot definitions + its own `settings.slots` bindings through
 * `SlotContext`; a slot-reading block inside (Gallery `source:'slot'`, Posts
 * `source:'slot'`) reads them with `useSlotContext()` and resolves its records
 * with `slotRecordsFor` — the SAME `resolveRecords` the entity block uses for
 * its own binding.
 *
 * The same context carries the TEMPLATE DATA (`templateData`: the record(s)
 * the template is rendering) for blocks with `source: 'template'` — see
 * `@sitesurge/types` `entities/templateData.ts`.
 *
 * In the template EDITOR no using block exists, so with no provider the
 * context falls back to the editor's preview bindings
 * (`templatePreviewSlotContext`: each slot's `previewBinding`, else auto).
 */
import {
    slotFor, slotPlaceholderText, templateDataPlaceholderText,
    type EntityRecord, type SlotBinding, type TemplateDataContext, type TemplateDataLookup, type TemplateSlot, type TemplateSlotContext,
} from '@sitesurge/types';
import { createContext, createResource, Show, useContext, type Component, } from 'solid-js';
import { resolveRecords, } from '../../services/entityBinding';
import { templatePreviewSlotContext, } from '../../stores/templatePreviewContext';

export const SlotContext = createContext<TemplateSlotContext | undefined>(undefined,);

/** A reactive slot context: `slots` + `bindings` are read through accessors. */
export function slotContextOf(
    slots: () => TemplateSlot[] | null | undefined,
    bindings: () => Record<string, SlotBinding> | null | undefined,
    props?: () => Record<string, string> | null | undefined,
    values?: () => Record<string, unknown> | null | undefined,
): TemplateSlotContext {
    return {
        get slots() { return slots() ?? []; },
        get bindings() { return bindings() ?? {}; },
        get props() { return props?.() ?? {}; },
        get values() { return values?.() ?? undefined; },
    };
}

/**
 * `base` (reactive slot getters kept) plus the template DATA of one render —
 * the record(s) the template is rendering (`templateDataOf`). Spreading `base`
 * would freeze its getters, so they are re-exposed.
 */
export function withTemplateData(
    base: TemplateSlotContext | null | undefined,
    data: TemplateDataContext | null,
): TemplateSlotContext {
    return {
        get slots() { return base?.slots ?? []; },
        get bindings() { return base?.bindings ?? {}; },
        get props() { return base?.props ?? {}; },
        get values() { return base?.values; },
        templateData: data,
    };
}

/** The slot context this block renders in (provider, else the template-editor preview). */
export function useSlotContext(): () => TemplateSlotContext | undefined {
    const provided = useContext(SlotContext,);
    return () => provided ?? templatePreviewSlotContext();
}

/** Slot data given directly on the context (`values`), as a record list; null = none given. */
export function givenSlotValue(ctx: TemplateSlotContext | null | undefined, slotId: string | undefined,): EntityRecord[] | null {
    if (!ctx?.values || !slotId || !(slotId in ctx.values)) return null;
    const v = ctx.values[slotId];
    return (Array.isArray(v,) ? v : v ? [v,] : []) as EntityRecord[];
}

export type SlotRecordsResult =
    | { ok: true; records: EntityRecord[]; }
    | { ok: false; reason: 'missing' | 'unfilled' | 'incompatible'; };

/**
 * Records for slot `slotId` holding `expectedType`. A non-array slot yields at
 * most one record. Never throws.
 */
export async function slotRecordsFor(
    ctx: TemplateSlotContext | null | undefined,
    slotId: string | undefined,
    expectedType: string,
): Promise<SlotRecordsResult> {
    // Data handed in directly (`{{ component('x', events=list) }}`) wins: no fetch.
    const given = givenSlotValue(ctx, slotId,);
    if (given) return { ok: true, records: given, };
    const found = slotFor(ctx, slotId, expectedType,);
    if (!found.ok) return { ok: false, reason: found.reason, };
    const records = await resolveRecords(found.slot.entityType, found.binding, found.slot.array ? null : 1, undefined,);
    return { ok: true, records, };
}

/** Record ids in order. */
export function slotRecordIds(records: EntityRecord[],): string[] {
    return records.map((r,) => String(r.id ?? '',)).filter(Boolean,);
}

/** True in the admin (previews), where an unusable slot explains itself. */
export function isAdminView(): boolean {
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin',);
}

/** "Slot `x` is not filled…" — admin previews only; nothing on the site. */
export const SlotPlaceholder: Component<{ slotId?: string; reason: 'missing' | 'unfilled' | 'incompatible'; }> = (props,) => (
    <Show when={isAdminView()}>
        <div class="block-message block-message--slot">{slotPlaceholderText(props.slotId, props.reason,)}</div>
    </Show>
);

/** "Gallery expects gallery_item template data…" — admin previews only. */
export const TemplateDataPlaceholder: Component<{ label: string; lookup: Extract<TemplateDataLookup, { ok: false; }>; }> = (props,) => (
    <Show when={isAdminView()}>
        <div class="block-message block-message--slot">{templateDataPlaceholderText(props.label, props.lookup,)}</div>
    </Show>
);

/**
 * The enclosing template's SLOTS as `{{ }}` variables — `{{ for events as e }}`
 * for an array slot `events`, `{{ hero.title }}` for a single one.
 *
 * Only slots whose id the text actually mentions are resolved (one records
 * fetch per slot; nothing at all for text that names none), through the same
 * `slotRecordsFor` the slot-reading blocks use. Missing / unfilled /
 * incompatible slot → `[]` (array) or null, so a loop renders nothing.
 * In the template editor this reads the preview bindings, like every slot.
 */
export function useSlotVariables(text: () => string | null | undefined,): () => Record<string, unknown> {
    const ctx = useSlotContext();
    const used = () => {
        const c = ctx();
        const src = text() ?? '';
        if (!c || !c.slots?.length || !src.includes('{{',)) return [];
        return (c.slots ?? []).filter((s,) => new RegExp(`(^|[^\\w.])${s.id.replace(/[^\w-]/g, '',)}\\b`,).test(src,));
    };
    const [vars,] = createResource(
        () => {
            const u = used();
            if (!u.length) return null;
            // Keyed on the bindings' CONTENT (a reconciled store keeps identity).
            const c = ctx();
            return JSON.stringify(u.map((s,) => [s.id, s.entityType, s.array, c?.bindings?.[s.id] ?? null, givenSlotValue(c, s.id,)?.map((r,) => r.id ?? r.slug ?? '') ?? null,]),);
        },
        async () => {
            const c = ctx();
            const out: Record<string, unknown> = {};
            for (const s of used()) {
                const r = await slotRecordsFor(c, s.id, s.entityType,);
                const records = r.ok ? r.records : [];
                out[s.id] = s.array ? records : (records[0] ?? null);
            }
            return out;
        },
    );
    // Component props (`{{ props.layout }}`) — plain values, no fetch.
    const propsVar = () => {
        const p = ctx()?.props;
        return p && Object.keys(p,).length && /\bprops\b/.test(text() ?? '',) ? { props: p, } : {};
    };
    return () => ({ ...(used().length ? (vars.latest ?? {}) : {}), ...propsVar(), });
}
