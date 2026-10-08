/**
 * Encode status + per-video settings for one encoded video (MediaEditModal).
 *
 * Reads `cms.media.video.info(id)` and polls every 3 s while a job is active.
 * Actions: Cancel / Retry / Re-encode (from the original, or a cheap
 * re-package), the access level, the teaser window, and the download links.
 */
import type { MediaAccessLevel, MediaVideoInfo, VideoDownloadOption, VideoJobStatus, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import { formatBytes, } from './videoFormat';
import './VideoMedia.scss';

const POLL_MS = 3000;
const ACTIVE: VideoJobStatus[] = ['queued', 'downloading', 'probing', 'encoding', 'uploading', 'finalizing',];

const BLOCKED_TEXT: Record<string, string> = {
    ffmpeg_missing: 'Waiting: ffmpeg is not installed on the server.',
    disk: 'Waiting: not enough free disk space on the server.',
    storage: 'Waiting: object storage is not reachable.',
};

type ReencodeKind = 'encode' | 'repackage';

export interface VideoStatusPanelProps {
    mediaId: string;
    /** Called after any change that alters the media row (access, teaser, job). */
    onChanged?: () => void;
}

const VideoStatusPanel: Component<VideoStatusPanelProps> = (props,) => {
    const toast = useToast();
    const [info, setInfo,] = createSignal<MediaVideoInfo | null>(null,);
    const [loadError, setLoadError,] = createSignal('',);
    const [downloads, setDownloads,] = createSignal<VideoDownloadOption[]>([],);
    const [busy, setBusy,] = createSignal(false,);
    const [menuOpen, setMenuOpen,] = createSignal(false,);
    const [confirmKind, setConfirmKind,] = createSignal<ReencodeKind | null>(null,);

    const active = () => {
        const i = info();
        if (!i) return false;
        return i.status === 'processing' || (!!i.job && ACTIVE.includes(i.job.status,));
    };

    const load = async () => {
        try {
            setInfo(await cms.media.video.info(props.mediaId,),);
            setLoadError('',);
        } catch (e) {
            setLoadError((e as Error)?.message || 'Could not load the video status.',);
        }
    };

    const loadDownloads = async () => {
        try { setDownloads((await cms.media.playback(props.mediaId,)).downloads ?? [],); }
        catch { setDownloads([],); }
    };

    onMount(() => {
        void load();
        void loadDownloads();
    },);

    // Poll while a job is active; refresh downloads when it settles.
    let wasActive = false;
    createEffect(() => {
        const isActive = active();
        if (wasActive && !isActive) {
            void loadDownloads();
            props.onChanged?.();
        }
        wasActive = isActive;
        if (!isActive) return;
        const t = setTimeout(() => void load(), POLL_MS,);
        onCleanup(() => clearTimeout(t,));
    },);

    const act = async (fn: () => Promise<MediaVideoInfo>, ok: string,) => {
        setBusy(true,);
        try {
            setInfo(await fn(),);
            toast.success(ok,);
            props.onChanged?.();
        } catch (e) {
            toast.error((e as Error)?.message || 'Action failed',);
        } finally {
            setBusy(false,);
        }
    };

    const cancelJob = () => act(() => cms.media.video.cancel(props.mediaId,), 'Encoding cancelled.',);
    const retryJob = () => act(() => cms.media.video.retry(props.mediaId,), 'Failed renditions queued again.',);
    const runReencode = async (kind: ReencodeKind,) => {
        setConfirmKind(null,);
        await act(
            () => cms.media.video.reencode(props.mediaId, { kind, },),
            kind === 'encode' ? 'Re-encode queued.' : 'Re-package queued.',
        );
    };

    const update = (body: Parameters<typeof cms.media.video.update>[1], ok: string,) =>
        act(() => cms.media.video.update(props.mediaId, body,), ok,);

    const setAccess = (level: MediaAccessLevel,) => {
        if (info()?.accessLevel === level) return;
        void update({ accessLevel: level, }, `Access set to ${level}. The video is being re-packaged.`,);
    };

    const commitSeconds = (field: 'teaserStartMs' | 'teaserDurationMs', raw: string,) => {
        const n = Number(raw,);
        if (!Number.isFinite(n,) || n < 0) return;
        const ms = Math.round(n * 1000,);
        if (info()?.[field] === ms) return;
        void update({ [field]: ms, }, 'Teaser updated.',);
    };

    const anyFailed = () => {
        const i = info();
        return !!i && (i.job?.status === 'failed' || i.renditions.some((r,) => r.status === 'failed'));
    };

    const statusLabel = () => {
        const i = info();
        if (!i) return '';
        const job = i.job;
        if (job && ACTIVE.includes(job.status,)) {
            return `${job.kind === 'repackage' ? 'Re-packaging' : 'Encoding'} — ${job.status} · ${Math.floor(i.progress,)}%`;
        }
        return { ready: 'Ready', processing: 'Processing', failed: 'Failed', uploading: 'Uploading', }[i.status] ?? i.status;
    };

    const originalText = () => {
        const i = info();
        if (!i) return '';
        if (!i.hasOriginal) return 'Original file deleted — a full re-encode is no longer possible.';
        if (!i.originalExpiresAt) return 'Original file kept indefinitely.';
        return `Original file kept until ${new Date(i.originalExpiresAt,).toLocaleDateString()}.`;
    };

    const toSeconds = (ms: number,) => String(Math.round(ms / 100,) / 10,);

    return (
        <div class="video-status-panel">
            <Show when={loadError()}>
                <div class="video-status-panel__error">{loadError()}</div>
            </Show>
            <Show when={info()}>
                {(i,) => (
                    <>
                        <div class="video-status-panel__summary">
                            <span class="video-status-panel__state">{statusLabel()}</span>
                            <Show when={i().width && i().height}>
                                <span>{i().width}&times;{i().height}</span>
                            </Show>
                            <Show when={i().encrypted}>
                                <span title={`Key version ${i().keyVersion ?? '?'}`}>Encrypted</span>
                            </Show>
                        </div>
                        <Show when={active()}>
                            <div class="video-progress">
                                <div class="video-progress__fill" style={{ width: `${i().progress}%`, }} />
                            </div>
                        </Show>
                        <Show when={i().job?.blockedReason}>
                            {(r,) => <div class="video-status-panel__blocked">{BLOCKED_TEXT[r()] ?? `Waiting: ${r()}`}</div>}
                        </Show>
                        <Show when={i().job?.error}>
                            <div class="video-status-panel__error">{i().job!.error}</div>
                        </Show>

                        <Show when={i().renditions.length}>
                            <table class="video-status-panel__table">
                                <thead>
                                    <tr>
                                        <th>Variant</th>
                                        <th>Quality</th>
                                        <th>Status</th>
                                        <th>Progress</th>
                                        <th>Size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={i().renditions}>
                                        {(r,) => (
                                            <tr>
                                                <td>{r.variant === 'teaser' ? 'Teaser' : 'Full'}</td>
                                                <td>{r.name}</td>
                                                <td>
                                                    {r.status}
                                                    <Show when={r.error}>
                                                        <div class="video-status-panel__row-error">{r.error}</div>
                                                    </Show>
                                                </td>
                                                <td>{Math.floor(r.progress,)}%</td>
                                                <td>{formatBytes(r.bytes,)}</td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </Show>

                        <div class="video-status-panel__actions">
                            <Show when={active()}>
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    disabled={busy() || i().job?.cancelRequested}
                                    onClick={() => void cancelJob()}
                                >
                                    {i().job?.cancelRequested ? 'Cancelling…' : 'Cancel'}
                                </button>
                            </Show>
                            <Show when={!active() && anyFailed()}>
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    disabled={busy()}
                                    onClick={() => void retryJob()}
                                >
                                    Retry
                                </button>
                            </Show>
                            <div class="video-status-panel__menu">
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    disabled={busy() || active()}
                                    aria-haspopup="menu"
                                    aria-expanded={menuOpen()}
                                    onClick={() => setMenuOpen(!menuOpen(),)}
                                >
                                    Re-encode &#9662;
                                </button>
                                <Show when={menuOpen()}>
                                    <ul class="video-status-panel__menu-list" role="menu" onMouseLeave={() => setMenuOpen(false,)}>
                                        <li>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                disabled={!i().hasOriginal}
                                                title={i().hasOriginal ? '' : 'The original file has been deleted.'}
                                                onClick={() => { setMenuOpen(false,); setConfirmKind('encode',); }}
                                            >
                                                Re-encode from original
                                                <Show when={!i().hasOriginal}>
                                                    <small>Unavailable — the original file was deleted.</small>
                                                </Show>
                                            </button>
                                        </li>
                                        <li>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { setMenuOpen(false,); setConfirmKind('repackage',); }}
                                            >
                                                Re-package (no re-encode)
                                                <small>Re-segments the stored qualities. Fast.</small>
                                            </button>
                                        </li>
                                    </ul>
                                </Show>
                            </div>
                        </div>

                        <div class="video-status-panel__grid">
                            <FormField label="Access" hint="Changing access re-packages the video (no re-encode).">
                                <select
                                    value={i().accessLevel}
                                    disabled={busy()}
                                    onChange={(e,) => setAccess(e.currentTarget.value as MediaAccessLevel,)}
                                >
                                    <option value="public">Public</option>
                                    <option value="private">Private (subscribers)</option>
                                </select>
                            </FormField>
                            <div>
                                <Toggle
                                    checked={i().hasTeaser}
                                    disabled={busy()}
                                    onChange={(v,) => void update({ teaserEnabled: v, }, v ? 'Teaser will be generated.' : 'Teaser removed.',)}
                                    label="Teaser"
                                    hint="Public preview clip"
                                />
                            </div>
                            <Show when={i().hasTeaser}>
                                <FormField label="Teaser start (seconds)">
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={toSeconds(i().teaserStartMs,)}
                                        disabled={busy()}
                                        onChange={(e,) => commitSeconds('teaserStartMs', e.currentTarget.value,)}
                                    />
                                </FormField>
                                <FormField label="Teaser length (seconds)">
                                    <input
                                        type="number"
                                        min="1"
                                        step="0.1"
                                        value={toSeconds(i().teaserDurationMs,)}
                                        disabled={busy()}
                                        onChange={(e,) => commitSeconds('teaserDurationMs', e.currentTarget.value,)}
                                    />
                                </FormField>
                            </Show>
                        </div>

                        <p class="video-status-panel__note">{originalText()}</p>

                        <Show when={downloads().length}>
                            <FormField label="Downloads">
                                <div class="video-status-panel__downloads">
                                    <For each={downloads()}>
                                        {(d,) => (
                                            <a href={d.url} target="_blank" rel="noopener">
                                                {d.quality}
                                                <Show when={d.bytes}> ({formatBytes(d.bytes,)})</Show>
                                            </a>
                                        )}
                                    </For>
                                </div>
                            </FormField>
                        </Show>
                    </>
                )}
            </Show>

            <ConfirmModal
                open={confirmKind() !== null}
                title={confirmKind() === 'encode' ? 'Re-encode from original?' : 'Re-package video?'}
                message={confirmKind() === 'encode'
                    ? 'Every quality is encoded again from the original file. This takes a while and uses the server CPU; the current version keeps playing until the new one is ready.'
                    : 'The stored qualities are re-segmented (and re-encrypted for private videos). No re-encode — this is fast.'}
                confirmLabel={confirmKind() === 'encode' ? 'Re-encode' : 'Re-package'}
                loading={busy()}
                onConfirm={() => void runReencode(confirmKind()!,)}
                onCancel={() => setConfirmKind(null,)}
            />
        </div>
    );
};

export default VideoStatusPanel;
