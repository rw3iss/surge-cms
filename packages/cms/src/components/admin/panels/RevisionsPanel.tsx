/**
 * Revision history for a page or post.
 *
 * Each row says how many blocks the snapshot holds, because that is the
 * question an operator is actually asking: "does this version have my content
 * in it?" A revision saved before full-tree snapshots existed holds none, and
 * restoring it puts only the title and status back — so it is labelled rather
 * than left to look like the others.
 */
import type { Revision, RevisionEntityType, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';

export interface RevisionsPanelProps {
    entityType: RevisionEntityType;
    entityId: string;
    /** Called after a successful restore so the editor can reload state */
    onRestored?: () => void;
}

/** List rows carry two fields the snapshot payload would otherwise be needed for. */
type RevisionRow = Revision & { blockCount?: number; snapshotVersion?: number; };

const RevisionsPanel: Component<RevisionsPanelProps> = (props,) => {
    const toast = useToast();
    const moduleFor = () => props.entityType === 'post' ? cms.posts : cms.pages;
    const [pending, setPending,] = createSignal<RevisionRow | null>(null,);
    const [busy, setBusy,] = createSignal(false,);

    const [revisions, { refetch, },] = createResource(
        () => `${props.entityType}:${props.entityId}`,
        async () => {
            if (!props.entityId || props.entityId === 'new') return [] as RevisionRow[];
            try {
                return (await moduleFor().listRevisions(props.entityId,) as RevisionRow[]) || [];
            } catch {
                return [] as RevisionRow[];
            }
        },
    );

    /** True for snapshots taken before block trees were captured. */
    const isLegacy = (rev: RevisionRow,) => (rev.snapshotVersion ?? 1) < 2;

    const handleRestore = async () => {
        const rev = pending();
        if (!rev) return;
        setBusy(true,);
        try {
            const res = await moduleFor().restoreRevision(props.entityId, rev.version,) as
                { restore?: { blocksRestored: number; metadataOnly: boolean; }; };
            const r = res?.restore;
            if (r?.metadataOnly) {
                toast.info(
                    `Restored v${rev.version}. This snapshot predates content history, `
                        + 'so only the page details came back — the blocks are unchanged.',
                );
            } else {
                toast.success(
                    `Restored v${rev.version} with ${r?.blocksRestored ?? 0} block`
                        + `${r?.blocksRestored === 1 ? '' : 's'}.`,
                );
            }
            setPending(null,);
            await refetch();
            props.onRestored?.();
        } catch (e) {
            toast.error('Failed to restore revision: ' + (e instanceof Error ? e.message : 'unknown'),);
        } finally {
            setBusy(false,);
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
                                    <Show
                                        when={!isLegacy(rev,)}
                                        fallback={
                                            <em title="Saved before content history existed. Restoring it changes the page details only.">
                                                details only
                                            </em>
                                        }
                                    >
                                        <em>
                                            {rev.blockCount ?? 0} block{rev.blockCount === 1 ? '' : 's'}
                                        </em>
                                    </Show>
                                    <Show when={rev.summary}>
                                        <em>{rev.summary}</em>
                                    </Show>
                                </div>
                                <button
                                    class="ui-button ui-button--sm ui-button--secondary"
                                    onClick={() => setPending(rev,)}
                                >
                                    Restore
                                </button>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            <ConfirmModal
                open={pending() !== null}
                title={`Restore v${pending()?.version ?? ''}?`}
                message={
                    isLegacy(pending() ?? {} as RevisionRow,)
                        ? 'This snapshot was taken before content history existed, so it holds no '
                            + 'blocks. Restoring it changes the page details only and leaves the '
                            + 'content as it is. The current version is saved first, so this is undoable.'
                        : `This replaces the current content with the ${pending()?.blockCount ?? 0} `
                            + 'block(s) in this version. Anything added since will be removed. The '
                            + 'current version is saved as a revision first, so you can undo it.'
                }
                confirmLabel="Restore"
                busyLabel="Restoring…"
                loading={busy()}
                onConfirm={handleRestore}
                onCancel={() => setPending(null,)}
            />
        </div>
    );
};

export default RevisionsPanel;
