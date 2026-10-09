/**
 * The live console's "Recordings" card: every saved recording of the show
 * (a version per recorded run — a part after a crash, or a restarted show),
 * the shown one playable right here exactly as on the post page, and:
 *   - Show on post   — choose which version the post's replay plays
 *   - Delete         — removes the video and ALL its files (storage + CDN);
 *                      deleting the shown one makes the post say
 *                      "Video has been removed."
 *   - Restart show   — (ended shows) re-open the show to record a new version
 */
import type { LiveRecordingVersion, } from '@sitesurge/types';
import { formatDateTime, formatFileSize, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import MediaVideo from '../../../../blocks/media/MediaVideo';
import { useToast, } from '../../../../common/toast';
import { cms, } from '../../../../../services/cmsClient';
import ConfirmModal from '../../../common/ConfirmModal';

const STATUS: Record<LiveRecordingVersion['status'], string> = {
    uploading: 'Uploading',
    processing: 'Processing',
    ready: 'Ready',
    failed: 'Encode failed',
    missing: 'Missing',
};

function duration(ms: number | null,): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000,);
    const h = Math.floor(s / 3600,);
    const m = Math.floor((s % 3600) / 60,);
    const sec = String(s % 60,).padStart(2, '0',);
    return h ? `${h}:${String(m,).padStart(2, '0',)}:${sec}` : `${m}:${sec}`;
}

export interface LiveRecordingsProps {
    postId: string;
    ended: boolean;
    /** Bumped by the console when a recording completes, to reload. */
    refreshKey?: number;
}

const LiveRecordings: Component<LiveRecordingsProps> = (props,) => {
    const toast = useToast();
    const [versions, setVersions,] = createSignal<LiveRecordingVersion[]>([],);
    const [playing, setPlaying,] = createSignal<string | null>(null,);
    const [busy, setBusy,] = createSignal<string | null>(null,);
    const [confirmDelete, setConfirmDelete,] = createSignal<LiveRecordingVersion | null>(null,);
    const [confirmRestart, setConfirmRestart,] = createSignal(false,);

    const load = async () => {
        try {
            const list = await cms.posts.liveReplays.list(props.postId,);
            setVersions(list,);
            if (!playing() || !list.some((v,) => v.mediaId === playing())) {
                setPlaying(list.find((v,) => v.current)?.mediaId ?? list[0]?.mediaId ?? null,);
            }
        } catch {
            /* not a live post / no permission — the card stays empty */
        }
    };

    createEffect(on(() => [props.postId, props.ended, props.refreshKey,] as const, () => void load(),),);
    // Processing versions update on their own — poll while any is processing.
    const timer = setInterval(() => {
        if (versions().some((v,) => v.status === 'processing' || v.status === 'uploading')) void load();
    }, 15_000,);
    onCleanup(() => clearInterval(timer,),);

    const select = async (v: LiveRecordingVersion,) => {
        setBusy(v.mediaId,);
        try {
            setVersions(await cms.posts.liveReplays.select(props.postId, v.mediaId,),);
            toast.success('The post now shows this recording.',);
        } catch (e) {
            toast.error((e as Error).message || 'Could not change the replay',);
        } finally {
            setBusy(null,);
        }
    };

    const remove = async () => {
        const v = confirmDelete();
        if (!v) return;
        setBusy(v.mediaId,);
        try {
            setVersions(await cms.posts.liveReplays.remove(props.postId, v.mediaId,),);
            if (playing() === v.mediaId) setPlaying(null,);
            toast.success(v.current ? 'Recording deleted — the post now says "Video has been removed."' : 'Recording deleted.',);
        } catch (e) {
            toast.error((e as Error).message || 'Delete failed',);
        } finally {
            setBusy(null,);
            setConfirmDelete(null,);
        }
    };

    const restart = async () => {
        setBusy('restart',);
        try {
            await cms.posts.liveRestart(props.postId,);
            toast.success('Show reopened — go live to record a new version.',);
            // The console derives its whole state from the post: reload it.
            window.location.reload();
        } catch (e) {
            toast.error((e as Error).message || 'Could not restart the show',);
            setBusy(null,);
        } finally {
            setConfirmRestart(false,);
        }
    };

    return (
        <div class="live-console__card live-recordings">
            <div class="live-recordings__head">
                <h3 class="live-console__card-title">Recordings</h3>
                <Show when={props.ended}>
                    <button
                        type="button"
                        class="ui-button ui-button--secondary ui-button--sm"
                        disabled={busy() === 'restart'}
                        onClick={() => setConfirmRestart(true,)}
                    >
                        Restart show
                    </button>
                </Show>
            </div>

            <Show
                when={versions().length > 0}
                fallback={
                    <p class="form-help-muted">
                        {props.ended ? 'No saved recording.' : 'Recordings appear here when a show ends.'}
                    </p>
                }
            >
                <Show when={playing()} keyed>
                    {(id,) => (
                        <div class="live-recordings__player">
                            <MediaVideo mediaId={id} showVariantSwitch showQualityMenu />
                        </div>
                    )}
                </Show>
                <ul class="live-recordings__list">
                    <For each={versions()}>
                        {(v,) => (
                            <li class={`live-recordings__item${playing() === v.mediaId ? ' live-recordings__item--playing' : ''}`}>
                                <button
                                    type="button"
                                    class="live-recordings__play"
                                    title="Play here"
                                    disabled={v.status === 'missing'}
                                    onClick={() => setPlaying(v.mediaId,)}
                                >
                                    <Show when={v.posterUrl} fallback={<span class="live-recordings__noposter">▶</span>}>
                                        <img src={v.posterUrl!} alt="" />
                                    </Show>
                                </button>
                                <div class="live-recordings__meta">
                                    <span class="live-recordings__date">{formatDateTime(v.recordedAt,)}</span>
                                    <span class="form-help-muted">
                                        {STATUS[v.status]}
                                        {v.durationMs ? ` · ${duration(v.durationMs,)}` : ''}
                                        {v.size ? ` · ${formatFileSize(v.size,)}` : ''}
                                    </span>
                                    <Show when={v.current}>
                                        <span class="badge badge--success">Shown on post</span>
                                    </Show>
                                </div>
                                <div class="live-recordings__actions">
                                    <Show when={!v.current && v.status !== 'missing'}>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--secondary ui-button--sm"
                                            disabled={busy() === v.mediaId}
                                            onClick={() => void select(v,)}
                                        >
                                            Show on post
                                        </button>
                                    </Show>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--danger ui-button--sm"
                                        disabled={busy() === v.mediaId}
                                        onClick={() => setConfirmDelete(v,)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>

            <ConfirmModal
                open={!!confirmDelete()}
                title="Delete this recording?"
                message={confirmDelete()?.current
                    ? 'The video and every saved version of it (all qualities, teaser, downloads, original) are deleted from storage and the CDN. The post stays and says "Video has been removed." This cannot be undone.'
                    : 'The video and every saved version of it (all qualities, teaser, downloads, original) are deleted from storage and the CDN. This cannot be undone.'}
                confirmLabel="Delete recording"
                danger
                loading={!!confirmDelete() && busy() === confirmDelete()!.mediaId}
                busyLabel="Deleting…"
                onConfirm={() => void remove()}
                onCancel={() => setConfirmDelete(null,)}
            />
            <ConfirmModal
                open={confirmRestart()}
                title="Restart the show?"
                message="The show opens again so you can go live and record a new version. Saved recordings are kept; the new one becomes the replay when it is saved."
                confirmLabel="Restart show"
                loading={busy() === 'restart'}
                busyLabel="Reopening…"
                onConfirm={() => void restart()}
                onCancel={() => setConfirmRestart(false,)}
            />
        </div>
    );
};

export default LiveRecordings;
