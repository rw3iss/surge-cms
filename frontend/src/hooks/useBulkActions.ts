import { createSignal, } from 'solid-js';
import { api, } from '../services/api';

export type BulkEntityType = 'post' | 'page' | 'campaign' | 'form' | 'message';

const ENTITY_ENDPOINT: Record<BulkEntityType, string> = {
    post: '/posts',
    page: '/pages',
    campaign: '/campaigns',
    form: '/forms',
    message: '/messages',
};

export interface UseBulkActionsOptions {
    entityType: BulkEntityType;
    onComplete?: () => void;
}

/**
 * Manage multi-select state and bulk actions for admin list pages.
 * Calls `POST /{entity}/bulk` with { ids, action, value }.
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
            const endpoint = `${ENTITY_ENDPOINT[opts.entityType]}/bulk`;
            const response = await api.post(endpoint, { ids, action, value, },);
            if (!response.success) {
                alert('Bulk action failed: ' + ((response as any).error?.message || 'unknown'),);
            } else {
                clear();
                opts.onComplete?.();
            }
        } catch (err: any) {
            alert('Bulk action error: ' + (err.message || 'unknown'),);
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
