/**
 * The global upload tray (bottom-right), mounted once in AdminLayout so direct
 * uploads keep running — and stay visible — while the editor moves between
 * admin pages. Renders nothing unless the `video` feature is on.
 *
 * Rows: running uploads (progress, speed, time left, pause/resume/cancel) and
 * sessions left unfinished by an earlier page ("Choose file to resume").
 */
import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import {
    cancel,
    dismiss,
    dismissFinished,
    hasActiveUploads,
    isLive,
    loadUnfinished,
    pause,
    resume,
    resumeWithFile,
    type UploadItem,
    uploads,
} from '../../../stores/uploads';
import { formatBytes, formatEta, formatSpeed, } from './videoFormat';
import './UploadTray.scss';

const STATE_LABEL: Record<UploadItem['state'], string> = {
    hashing: 'Preparing…',
    uploading: 'Uploading',
    paused: 'Paused',
    completing: 'Finishing…',
    done: 'Done',
    error: 'Failed',
    cancelled: 'Cancelled',
    unfinished: 'Unfinished',
};

const UploadRow: Component<{ item: UploadItem; }> = (p,) => {
    let fileInput: HTMLInputElement | undefined;
    const [pickError, setPickError,] = createSignal('',);

    const onPick = (e: Event,) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !p.item.sessionId) return;
        setPickError(resumeWithFile(p.item.sessionId, file,) ?? '',);
    };

    const pct = () => Math.floor(p.item.percent,);
    const running = () => p.item.state === 'uploading' || p.item.state === 'hashing';
    const settled = () => ['done', 'cancelled',].includes(p.item.state,) ||
        (p.item.state === 'error' && !isLive(p.item.id,));

    return (
        <li class={`upload-tray__row upload-tray__row--${p.item.state}`}>
            <div class="upload-tray__row-top">
                <span class="upload-tray__name" title={p.item.name}>{p.item.name}</span>
                <span class="upload-tray__pct">{pct()}%</span>
            </div>
            <div class="upload-tray__bar" role="progressbar" aria-valuenow={pct()} aria-valuemin={0} aria-valuemax={100}>
                <div class="upload-tray__bar-fill" style={{ width: `${p.item.percent}%`, }} />
            </div>
            <div class="upload-tray__row-bottom">
                <span class="upload-tray__meta">
                    <Show
                        when={p.item.state === 'uploading'}
                        fallback={
                            <>
                                {STATE_LABEL[p.item.state]}
                                <Show when={p.item.state === 'unfinished'}>
                                    {' '}— {formatBytes(p.item.loaded,)} of {formatBytes(p.item.size,)}
                                </Show>
                            </>
                        }
                    >
                        {formatSpeed(p.item.speed,)}
                        <Show when={p.item.eta !== null}> · {formatEta(p.item.eta,)} left</Show>
                    </Show>
                </span>
                <span class="upload-tray__actions">
                    <Show when={running()}>
                        <button type="button" class="upload-tray__btn" onClick={() => pause(p.item.id,)}>Pause</button>
                    </Show>
                    <Show when={p.item.state === 'paused' || (p.item.state === 'error' && isLive(p.item.id,))}>
                        <button type="button" class="upload-tray__btn" onClick={() => resume(p.item.id,)}>
                            {p.item.state === 'error' ? 'Retry' : 'Resume'}
                        </button>
                    </Show>
                    <Show when={p.item.state === 'unfinished'}>
                        <button type="button" class="upload-tray__btn upload-tray__btn--primary" onClick={() => fileInput?.click()}>
                            Choose file to resume
                        </button>
                        <input ref={fileInput} type="file" class="upload-tray__file" onChange={onPick} />
                    </Show>
                    <Show when={!settled() && p.item.state !== 'completing'}>
                        <button
                            type="button"
                            class="upload-tray__btn upload-tray__btn--danger"
                            onClick={() => void cancel(p.item.id,)}
                            title={p.item.state === 'unfinished' ? 'Discard the uploaded parts' : 'Cancel upload'}
                        >
                            {p.item.state === 'unfinished' ? 'Discard' : 'Cancel'}
                        </button>
                    </Show>
                    <Show when={settled()}>
                        <button type="button" class="upload-tray__btn" onClick={() => dismiss(p.item.id,)} aria-label="Dismiss">
                            &times;
                        </button>
                    </Show>
                </span>
            </div>
            <Show when={pickError() || p.item.error}>
                <div class="upload-tray__error">{pickError() || p.item.error}</div>
            </Show>
        </li>
    );
};

const Tray: Component = () => {
    const [collapsed, setCollapsed,] = createSignal(false,);

    const onBeforeUnload = (e: BeforeUnloadEvent,) => {
        if (!hasActiveUploads()) return;
        e.preventDefault();
        e.returnValue = '';
    };

    onMount(() => {
        void loadUnfinished();
        window.addEventListener('beforeunload', onBeforeUnload,);
    },);
    onCleanup(() => window.removeEventListener('beforeunload', onBeforeUnload,));

    const activeCount = () => uploads.items.filter((i,) => ['hashing', 'uploading', 'completing', 'paused',].includes(i.state,)).length;
    const anyFinished = () => uploads.items.some((i,) => i.state === 'done' || i.state === 'cancelled',);
    const overall = () => {
        const live = uploads.items.filter((i,) => ['hashing', 'uploading', 'completing', 'paused',].includes(i.state,),);
        const total = live.reduce((a, i,) => a + i.size, 0,);
        return total ? Math.floor((live.reduce((a, i,) => a + i.loaded, 0,) / total) * 100,) : 0;
    };

    return (
        <Show when={uploads.items.length}>
            <aside class={`upload-tray${collapsed() ? ' upload-tray--collapsed' : ''}`} aria-label="Uploads">
                <header class="upload-tray__header">
                    <button type="button" class="upload-tray__title" onClick={() => setCollapsed(!collapsed(),)} aria-expanded={!collapsed()}>
                        <span>
                            Uploads
                            <Show when={activeCount()}> — {activeCount()} active · {overall()}%</Show>
                        </span>
                        <span class="upload-tray__chevron" aria-hidden="true">{collapsed() ? '▴' : '▾'}</span>
                    </button>
                    <Show when={anyFinished() && !collapsed()}>
                        <button type="button" class="upload-tray__btn" onClick={dismissFinished}>Clear</button>
                    </Show>
                </header>
                <Show when={!collapsed()}>
                    <ul class="upload-tray__list">
                        <For each={uploads.items}>{(item,) => <UploadRow item={item} />}</For>
                    </ul>
                </Show>
            </aside>
        </Show>
    );
};

/** Mount point — renders the tray only while the video feature is enabled. */
const UploadTray: Component = () => (
    <Show when={isFeatureEnabled('video',)}>
        <Tray />
    </Show>
);

export default UploadTray;
