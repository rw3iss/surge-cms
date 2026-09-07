/**
 * What a binding actually resolves to, shown under the button that sets it.
 *
 * Before this the panel said "Select entities (3)" and nothing else — you could
 * not tell WHICH three, and a saved query was completely opaque. Both are
 * things you set once and then have to trust, which is exactly when a summary
 * earns its place.
 *
 * For a query it also runs the query LIVE. A filter that reads plausibly and
 * matches nothing is the common failure, and the only way to see that is to
 * ask the server.
 */
import { Component, createMemo, createResource, For, Show, } from 'solid-js';
import type { EntityQuery, EntityRecord, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import './EntityBindingSummary.scss';

export interface EntityBindingSummaryProps {
    entityType: string;
    /** Explicit record ids (single/list modes). */
    refs?: string[];
    /** The saved query (query mode). */
    query?: EntityQuery;
}

/** Best human label for a record, whatever shape the type happens to have. */
function labelOf(r: EntityRecord,): string {
    const rec = r as unknown as Record<string, unknown>;
    for (const k of ['title', 'name', 'label', 'slug',]) {
        const v = rec[k];
        if (typeof v === 'string' && v.trim()) return v;
    }
    // Falling back to the id is deliberate — an unlabelled record still needs
    // to be distinguishable from the others.
    return String(rec.id ?? '(untitled)',);
}

/** Render one filter clause as `property op value`. */
function clauseText(field: string, raw: unknown,): string {
    const OPS: Record<string, string> = {
        eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', like: 'contains', in: 'is any of',
    };
    if (raw && typeof raw === 'object' && 'op' in (raw as object)) {
        const { op, value, } = raw as { op: string; value: unknown; };
        const v = Array.isArray(value,) ? value.join(', ',) : String(value,);
        return `${field} ${OPS[op] ?? op} ${v}`;
    }
    return `${field} = ${String(raw,)}`;
}

const EntityBindingSummary: Component<EntityBindingSummaryProps> = (props,) => {
    /** The query's clauses, as readable one-liners. */
    const clauseLines = createMemo(() => {
        const f = props.query?.filter;
        if (!f || typeof f !== 'object') return [] as string[];
        return Object.entries(f as Record<string, unknown>,).map(([k, v,],) => clauseText(k, v,));
    },);

    /**
     * The records this binding resolves to.
     *
     * Keyed on the serialised binding so editing the query refetches, and so an
     * unchanged binding doesn't re-request on every render.
     */
    const [records] = createResource(
        () => JSON.stringify({ t: props.entityType, r: props.refs, q: props.query, },),
        async () => {
            try {
                if (props.refs?.length) {
                    const found = await Promise.all(
                        // Capped: this is a summary, not the picker. Beyond a
                        // handful the count is the useful information.
                        props.refs.slice(0, 12,).map((id,) =>
                            cms.entities.getOne(props.entityType, id,).catch(() => null,)),
                    );
                    return found.filter(Boolean,) as EntityRecord[];
                }
                if (props.query) {
                    const res = await cms.entities.list(props.entityType, {
                        ...props.query, limit: 8, page: 1,
                    },);
                    return (res.data ?? []) as EntityRecord[];
                }
            } catch {
                // A failed preview must not break the editor panel — the
                // binding is still saved and valid.
                return [] as EntityRecord[];
            }
            return [] as EntityRecord[];
        },
    );

    const hasBinding = () => Boolean(props.refs?.length || props.query,);

    return (
        <Show when={hasBinding()}>
            <div class="entity-binding-summary">
                <Show when={clauseLines().length > 0}>
                    <ul class="entity-binding-summary__clauses">
                        <For each={clauseLines()}>
                            {(line,) => <li>{line}</li>}
                        </For>
                    </ul>
                </Show>

                <Show
                    when={!records.loading}
                    fallback={<p class="entity-binding-summary__note">Loading…</p>}
                >
                    <Show
                        when={(records() ?? []).length > 0}
                        fallback={
                            <p class="entity-binding-summary__note entity-binding-summary__note--warn">
                                {props.query
                                    ? 'This query currently matches no records.'
                                    : 'None of the selected records could be loaded.'}
                            </p>
                        }
                    >
                        <ul class="entity-binding-summary__records">
                            <For each={records()}>
                                {(r,) => <li title={String((r as unknown as { id: string; }).id,)}>{labelOf(r,)}</li>}
                            </For>
                        </ul>
                        <Show when={props.query}>
                            <p class="entity-binding-summary__note">
                                Live preview of the first {(records() ?? []).length}.
                            </p>
                        </Show>
                        <Show when={(props.refs?.length ?? 0) > 12}>
                            <p class="entity-binding-summary__note">
                                + {(props.refs?.length ?? 0) - 12} more
                            </p>
                        </Show>
                    </Show>
                </Show>
            </div>
        </Show>
    );
};

export default EntityBindingSummary;
