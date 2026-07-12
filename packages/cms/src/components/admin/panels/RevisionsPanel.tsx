import type { Revision, RevisionEntityType, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';

export interface RevisionsPanelProps {
    entityType: RevisionEntityType;
    entityId: string;
    /** Called after a successful restore so the editor can reload state */
    onRestored?: () => void;
}

const RevisionsPanel: Component<RevisionsPanelProps> = (props,) => {
    const moduleFor = () => props.entityType === 'post' ? cms.posts : cms.pages;

    const [revisions, { refetch, },] = createResource(
        () => `${props.entityType}:${props.entityId}`,
        async () => {
            if (!props.entityId || props.entityId === 'new') return [] as Revision[];
            try {
                return (await moduleFor().listRevisions(props.entityId,) as Revision[]) || [];
            } catch {
                return [] as Revision[];
            }
        },
    );

    const handleRestore = async (version: number,) => {
        if (!confirm(`Restore revision v${version}? The current state will be saved as a revision first.`,)) {
            return;
        }
        try {
            await moduleFor().restoreRevision(props.entityId, version,);
            await refetch();
            props.onRestored?.();
        } catch (e) {
            alert('Failed to restore revision: ' + (e instanceof Error ? e.message : 'unknown'),);
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
