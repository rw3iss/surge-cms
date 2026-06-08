import { createSignal, } from 'solid-js';
import { cms, } from '../services/cmsClient';

export type BulkEntityType = 'post' | 'page' | 'campaign' | 'form' | 'message';

interface BulkBody {
    ids: string[];
    action: 'delete' | 'status';
    value?: string;
}

/**
 * Maps an entity type to its `cms.<module>.bulk` method. The wire body for
 * every bulk endpoint is `{ ids, action, value }` (the backend's shared
 * bulkActions runner reads `value`); the per-entity DTOs vary slightly in
 * field naming, so the body is cast at the call boundary.
 */
const ENTITY_BULK: Record<BulkEntityType, (body: BulkBody,) => Promise<{ updated: number; }>> = {
    post: (body,) => cms.posts.bulk(body as never,),
    page: (body,) => cms.pages.bulk(body as never,),
    campaign: (body,) => cms.campaigns.bulk(body as never,),
    form: (body,) => cms.forms.bulk(body as never,),
    message: (body,) => cms.messages.bulk(body as never,),
};

export interface UseBulkActionsOptions {
    entityType: BulkEntityType;
    onComplete?: () => void;
}

/**
 * Manage multi-select state and bulk actions for admin list pages.
 * Calls `cms.<entity>.bulk({ ids, action, value })`; errors surface via
 * the client's error bus (toast).
 */
export function useBulkActions(opts: UseBulkActionsOptions,) {
    const [selected, setSelected,] = createSignal<Set<string>>(new Set<string>(),);
    const [busy, setBusy,] = createSignal(false,);

    const isSelected = (id: string,) => selected().has(id,);
    const toggle = (id: string,) => {
        const next = new Set<string>(selected(),);
        if (next.has(id,)) next.delete(id,);
        else next.add(id,);
        setSelected(next,);
    };
    const clear = () => setSelected(new Set<string>(),);
    const selectedCount = () => selected().size;
    const selectedIds = () => Array.from(selected(),);

    const allSelected = (items: Array<{ id: string; }>,): boolean => {
        if (!items.length) return false;
        return items.every(i => selected().has(i.id,));
    };
    const toggleAll = (items: Array<{ id: string; }>,) => {
        if (allSelected(items,)) {
            clear();
        } else {
            setSelected(new Set<string>(items.map(i => i.id,),),);
        }
    };

    const runBulk = async (action: 'delete' | 'status', value?: string,) => {
        const ids = selectedIds();
        if (ids.length === 0) return;
        const confirmMsg = action === 'delete' ?
            `Delete ${ids.length} ${opts.entityType}(s)?` :
            `Change status of ${ids.length} ${opts.entityType}(s) to "${value}"?`;
        if (!confirm(confirmMsg,)) return;

        setBusy(true,);
        try {
            await ENTITY_BULK[opts.entityType]({ ids, action, value, },);
            clear();
            opts.onComplete?.();
        } catch {
            // The cms.onError bus surfaces the error/toast.
        } finally {
            setBusy(false,);
        }
    };

    const applyDelete = () => runBulk('delete',);
    const applyStatus = (value: string,) => runBulk('status', value,);

    return {
        selected,
        selectedCount,
        selectedIds,
        isSelected,
        toggle,
        toggleAll,
        allSelected,
        clear,
        busy,
        applyDelete,
        applyStatus,
    };
}
