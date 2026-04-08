import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

export interface RevisionsPanelProps {
    entityType: 'post' | 'page';
    entityId: string;
    /** Called after a successful restore so the editor can reload state */
    onRestored?: () => void;
}

interface Revision {
    id: string;
    version: number;
    authorId: string | null;
    authorName: string | null;
    summary: string | null;
    createdAt: string;
}

const endpointFor = (type: 'post' | 'page',) => type === 'post' ? '/posts' : '/pages';

const RevisionsPanel: Component<RevisionsPanelProps> = (props,) => {
    const [revisions, { refetch, },] = createResource(
        () => `${props.entityType}:${props.entityId}`,
        async () => {
            if (!props.entityId || props.entityId === 'new') return [] as Revision[];
            const response = await api.get(
                `${endpointFor(props.entityType,)}/${props.entityId}/revisions`,
            );
            return (response.success ? ((response as any).data as Revision[]) : []) || [];
        },
    );

    const handleRestore = async (version: number,) => {
        if (!confirm(`Restore revision v${version}? The current state will be saved as a revision first.`,)) {
            return;
        }
        const response = await api.post(
            `${endpointFor(props.entityType,)}/${props.entityId}/revisions/${version}/restore`,
            {},
        );
        if (response.success) {
            await refetch();
            props.onRestored?.();
        } else {
            alert('Failed to restore revision: ' + ((response as any).error?.message || 'unknown'),);
        }
    };

    const formatDate = (iso: string,) => {
        const d = new Date(iso,);
        return d.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        },);
    };

    return (
        <div class="revisions-panel">
            <div class="revisions-panel__header">Revision History</div>
            <Show
                when={revisions() && revisions()!.length > 0}
                fallback={<div class="revisions-panel__empty">No revisions yet.</div>}
            >
                <div class="revisions-panel__list">
                    <For each={revisions()}>
                        {(rev,) => (
                            <div class="revisions-panel__item">
                                <div class="revisions-panel__meta">
                                    <strong>v{rev.version}</strong>
                                    <span>
                                        {formatDate(rev.createdAt,)}
                                        {rev.authorName ? ` · ${rev.authorName}` : ''}
                                    </span>
                                    <Show when={rev.summary}>
                                        <em>{rev.summary}</em>
                                    </Show>
                                </div>
                                <button
                                    class="btn btn--small btn--secondary"
                                    onClick={() => handleRestore(rev.version,)}
                                >
                                    Restore
                                </button>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};

export default RevisionsPanel;
