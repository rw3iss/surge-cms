/**
 * Settings → Media → Video (`video` feature): encoder tooling status, encode
 * settings + quality ladder, upload limits, originals/teaser/downloads, and
 * the shared encryption keys (with rotation).
 *
 * Text/number fields commit on change (blur/Enter) into a local draft store;
 * Save sends only the keys that differ from the loaded settings.
 */
import type { VideoEncodePreset, VideoKeyVersion, VideoLadderRung, VideoSettings, VideoToolingStatus, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { createStore, reconcile, unwrap, } from 'solid-js/store';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import { formatBytes, } from '../media/videoFormat';
import ConfirmModal from '../common/ConfirmModal';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import './VideoSettingsPanel.scss';

const PRESETS: VideoEncodePreset[] = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium',];

type NumKey = {
    [K in keyof VideoSettings]: VideoSettings[K] extends number ? K : never;
}[keyof VideoSettings];

const VideoSettingsPanel: Component = () => {
    const toast = useToast();
    const [orig, setOrig,] = createSignal<VideoSettings | null>(null,);
    const [draft, setDraft,] = createStore<{ s: VideoSettings | null; }>({ s: null, },);
    const [status, setStatus,] = createSignal<VideoToolingStatus | null>(null,);
    const [keys, setKeys,] = createSignal<VideoKeyVersion[]>([],);
    const [saving, setSaving,] = createSignal(false,);
    const [rotateOpen, setRotateOpen,] = createSignal(false,);
    const [rotating, setRotating,] = createSignal(false,);
    const [loadError, setLoadError,] = createSignal('',);

    const loadSettings = async () => {
        try {
            const s = await cms.media.video.settings();
            setOrig(structuredClone(s,),);
            setDraft('s', reconcile(structuredClone(s,),),);
        } catch (e) {
            setLoadError((e as Error)?.message || 'Could not load video settings.',);
        }
    };
    const loadStatus = async () => {
        try { setStatus(await cms.media.video.status(),); } catch { /* error bus */ }
    };
    const loadKeys = async () => {
        try { setKeys(await cms.media.video.keys(),); } catch { /* error bus */ }
    };

    onMount(() => {
        void loadSettings();
        void loadStatus();
        void loadKeys();
    },);

    const set = <K extends keyof VideoSettings,>(k: K, v: VideoSettings[K],) => setDraft('s', k as never, v as never,);

    const num = (k: NumKey, raw: string, min?: number, max?: number,) => {
        let n = Number(raw,);
        if (!Number.isFinite(n,)) return;
        if (min !== undefined) n = Math.max(min, n,);
        if (max !== undefined) n = Math.min(max, n,);
        set(k, n,);
    };

    const setRung = (i: number, p: Partial<VideoLadderRung>,) => setDraft('s', 'ladder', i, p,);

    const changes = (): Partial<VideoSettings> => {
        const o = orig();
        const d = draft.s ? unwrap(draft.s,) : null;
        if (!o || !d) return {};
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(d,) as (keyof VideoSettings)[]) {
            if (JSON.stringify(d[k],) !== JSON.stringify(o[k],)) out[k] = d[k];
        }
        return out as Partial<VideoSettings>;
    };

    const save = async () => {
        const patch = changes();
        if (!Object.keys(patch,).length) {
            toast.success('No changes to save.',);
            return;
        }
        setSaving(true,);
        try {
            const s = await cms.media.video.updateSettings(patch,);
            setOrig(structuredClone(s,),);
            setDraft('s', reconcile(structuredClone(s,),),);
            toast.success('Video settings saved.',);
        } catch (e) {
            toast.error((e as Error)?.message || 'Save failed',);
        } finally {
            setSaving(false,);
        }
    };

    const rotate = async () => {
        setRotating(true,);
        try {
            const r = await cms.media.video.rotateKey();
            toast.success(`Key version ${r.version} is now current. ${r.repackageQueued} private video(s) queued for re-packaging.`,);
            setRotateOpen(false,);
            void loadKeys();
        } catch (e) {
            toast.error((e as Error)?.message || 'Key rotation failed',);
        } finally {
            setRotating(false,);
        }
    };

    const yes = (b: boolean,) => (b ? 'yes' : 'no');
    const threadsMax = () => status()?.threadsMax ?? 16;

    return (
        <section class="admin-section video-settings">
            <header class="admin-section__header">
                <h2>Video</h2>
                <p class="form-help-muted">
                    How uploaded videos are encoded into adaptive streams (HLS), and who may watch them.
                </p>
            </header>

            <div class="admin-section__body">
                <Show when={status()}>
                    {(st,) => (
                        <div class={`video-settings__status${st().ffmpeg && st().libx264 && st().encoderEnabled && st().storageReady ? '' : ' video-settings__status--warn'}`}>
                            <span>ffmpeg: {st().ffmpeg ? (st().version ?? 'yes') : 'missing'}</span>
                            <span>libx264: {yes(st().libx264,)}</span>
                            <span>Encoder: {st().encoderEnabled ? 'enabled' : 'disabled'}</span>
                            <span>Disk free: {formatBytes(st().diskFreeBytes,)}</span>
                            <span>Temp dir: <code>{st().tempDir}</code></span>
                            <span>Storage: {st().storageReady ? 'ready' : (st().storageProblem ?? 'not ready')}</span>
                        </div>
                    )}
                </Show>

                <Show when={loadError()}>
                    <div class="alert alert--error">{loadError()}</div>
                </Show>

                <Show when={draft.s}>
                    {(s,) => (
                        <>
                            <h3 class="video-settings__subhead">Encoding</h3>
                            <div class="video-settings__grid">
                                <FormField label="Threads" hint={`ffmpeg threads per encode (1–${threadsMax()}). 1 is gentlest on the site.`}>
                                    <input
                                        type="number"
                                        min="1"
                                        max={threadsMax()}
                                        value={s().encodeThreads}
                                        onChange={(e,) => num('encodeThreads', e.currentTarget.value, 1, threadsMax(),)}
                                    />
                                </FormField>
                                <FormField label="Preset" hint="Faster presets use less CPU, larger files.">
                                    <select value={s().preset} onChange={(e,) => set('preset', e.currentTarget.value as VideoEncodePreset,)}>
                                        <For each={PRESETS}>{(p,) => <option value={p}>{p}</option>}</For>
                                    </select>
                                </FormField>
                                <FormField label="CRF" hint="Quality (lower = better, bigger). 18–28.">
                                    <input type="number" min="0" max="51" value={s().crf} onChange={(e,) => num('crf', e.currentTarget.value, 0, 51,)} />
                                </FormField>
                                <FormField label="Segment seconds">
                                    <input
                                        type="number"
                                        min="1"
                                        max="30"
                                        value={s().segmentSeconds}
                                        onChange={(e,) => num('segmentSeconds', e.currentTarget.value, 1, 30,)}
                                    />
                                </FormField>
                                <FormField label="Encode order" hint="Fast-first makes a video playable within minutes.">
                                    <select value={s().encodeOrder} onChange={(e,) => set('encodeOrder', e.currentTarget.value as VideoSettings['encodeOrder'],)}>
                                        <option value="fast-first">Fast first (lowest quality first)</option>
                                        <option value="top-down">Top down (highest first)</option>
                                    </select>
                                </FormField>
                                <FormField label="Default quality" hint="Where the player starts.">
                                    <select
                                        value={String(s().defaultQuality,)}
                                        onChange={(e,) => {
                                            const v = e.currentTarget.value;
                                            set('defaultQuality', v === 'auto' || v === 'highest' ? v : Number(v,),);
                                        }}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="highest">Highest</option>
                                        <For each={s().ladder}>{(r,) => <option value={String(r.height,)}>{r.name}</option>}</For>
                                    </select>
                                </FormField>
                                <FormField label="Poster at (%)" hint="Where in the video the poster frame is taken.">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={s().posterAtPercent}
                                        onChange={(e,) => num('posterAtPercent', e.currentTarget.value, 0, 100,)}
                                    />
                                </FormField>
                                <FormField label="Min free disk (GB)" hint="Jobs wait while free space is below this.">
                                    <input
                                        type="number"
                                        min="0"
                                        value={s().minFreeDiskGb}
                                        onChange={(e,) => num('minFreeDiskGb', e.currentTarget.value, 0,)}
                                    />
                                </FormField>
                            </div>

                            <h3 class="video-settings__subhead">Quality ladder</h3>
                            <table class="video-settings__ladder">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Height (px)</th>
                                        <th>Max rate (kbps)</th>
                                        <th>Audio (kbps)</th>
                                        <th>Enabled</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={s().ladder}>
                                        {(r, i,) => (
                                            <tr>
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={r.name}
                                                        aria-label="Rung name"
                                                        onChange={(e,) => setRung(i(), { name: e.currentTarget.value.trim() || r.name, },)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="144"
                                                        value={r.height}
                                                        aria-label="Height"
                                                        onChange={(e,) => setRung(i(), { height: Math.max(144, Number(e.currentTarget.value,) || r.height,), },)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="100"
                                                        value={r.maxrateKbps}
                                                        aria-label="Max rate"
                                                        onChange={(e,) => setRung(i(), { maxrateKbps: Math.max(100, Number(e.currentTarget.value,) || r.maxrateKbps,), },)}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="32"
                                                        value={r.audioKbps}
                                                        aria-label="Audio bitrate"
                                                        onChange={(e,) => setRung(i(), { audioKbps: Math.max(32, Number(e.currentTarget.value,) || r.audioKbps,), },)}
                                                    />
                                                </td>
                                                <td>
                                                    <Toggle
                                                        checked={r.enabled}
                                                        onChange={(v,) => setRung(i(), { enabled: v, },)}
                                                        ariaLabel={`Enable ${r.name}`}
                                                        size="sm"
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>

                            <h3 class="video-settings__subhead">Uploads &amp; storage</h3>
                            <div class="video-settings__grid">
                                <FormField label="Max upload (GB)">
                                    <input
                                        type="number"
                                        min="1"
                                        value={s().maxUploadGb}
                                        onChange={(e,) => num('maxUploadGb', e.currentTarget.value, 1,)}
                                    />
                                </FormField>
                                <FormField label="Part size (MB)" hint="Every multipart part except the last (5 MB minimum).">
                                    <input
                                        type="number"
                                        min="5"
                                        value={s().partSizeMb}
                                        onChange={(e,) => num('partSizeMb', e.currentTarget.value, 5,)}
                                    />
                                </FormField>
                                <FormField label="Original retention (days)" hint="0 = keep forever.">
                                    <input
                                        type="number"
                                        min="0"
                                        value={s().originalRetentionDays}
                                        disabled={!s().keepOriginal}
                                        onChange={(e,) => num('originalRetentionDays', e.currentTarget.value, 0,)}
                                    />
                                </FormField>
                                <FormField label="Key base URL" hint="Origin for encryption-key URLs. Blank = the site URL. Affects new encodes only.">
                                    <input
                                        type="text"
                                        value={s().keyBaseUrl}
                                        placeholder="https://example.com"
                                        onChange={(e,) => set('keyBaseUrl', e.currentTarget.value.trim(),)}
                                    />
                                </FormField>
                            </div>
                            <div class="video-settings__toggles">
                                <Toggle
                                    checked={s().keepOriginal}
                                    onChange={(v,) => set('keepOriginal', v,)}
                                    label="Keep original file by default"
                                    hint="Needed for a later re-encode."
                                />
                                <Toggle
                                    checked={s().downloadsEnabled}
                                    onChange={(v,) => set('downloadsEnabled', v,)}
                                    label="Per-quality MP4 downloads"
                                    hint="Also makes a re-package after key rotation possible without re-encoding."
                                />
                                <Toggle
                                    checked={s().sprites}
                                    onChange={(v,) => set('sprites', v,)}
                                    label="Scrub-bar preview thumbnails"
                                />
                            </div>

                            <h3 class="video-settings__subhead">Teaser</h3>
                            <div class="video-settings__toggles">
                                <Toggle
                                    checked={s().teaserEnabled}
                                    onChange={(v,) => set('teaserEnabled', v,)}
                                    label="Generate a teaser for new uploads"
                                    hint="A public preview clip — what non-subscribers see of a private video."
                                />
                            </div>
                            <Show when={s().teaserEnabled}>
                                <div class="video-settings__grid">
                                    <FormField label="Teaser length (seconds)">
                                        <input
                                            type="number"
                                            min="1"
                                            value={s().teaserSeconds}
                                            onChange={(e,) => num('teaserSeconds', e.currentTarget.value, 1,)}
                                        />
                                    </FormField>
                                    <FormField label="Teaser start (seconds)">
                                        <input
                                            type="number"
                                            min="0"
                                            value={s().teaserStartSeconds}
                                            onChange={(e,) => num('teaserStartSeconds', e.currentTarget.value, 0,)}
                                        />
                                    </FormField>
                                    <FormField label="Teaser max height (px)">
                                        <input
                                            type="number"
                                            min="144"
                                            value={s().teaserMaxHeight}
                                            onChange={(e,) => num('teaserMaxHeight', e.currentTarget.value, 144,)}
                                        />
                                    </FormField>
                                </div>
                            </Show>

                            <div class="video-settings__actions">
                                <button type="button" class="ui-button ui-button--primary" onClick={() => void save()} disabled={saving()}>
                                    {saving() ? 'Saving…' : 'Save video settings'}
                                </button>
                            </div>
                        </>
                    )}
                </Show>

                <h3 class="video-settings__subhead">Encryption keys</h3>
                <p class="form-help-muted">
                    Private videos are encrypted with a shared, versioned key. Only viewers allowed to watch
                    private videos can fetch it.
                </p>
                <table class="video-settings__keys">
                    <thead>
                        <tr>
                            <th>Version</th>
                            <th>Created</th>
                            <th>Retired</th>
                            <th>Videos</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        <For each={keys()} fallback={<tr><td colSpan={5} class="form-help-muted">No keys yet — one is created with the first private video.</td></tr>}>
                            {(k,) => (
                                <tr>
                                    <td>v{k.version}</td>
                                    <td>{new Date(k.createdAt,).toLocaleString()}</td>
                                    <td>{k.retiredAt ? new Date(k.retiredAt,).toLocaleString() : '—'}</td>
                                    <td>{k.videoCount}</td>
                                    <td>
                                        <Show when={k.current}>
                                            <span class="video-settings__current">Current</span>
                                        </Show>
                                    </td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
                <div class="video-settings__actions">
                    <button type="button" class="ui-button ui-button--secondary" onClick={() => setRotateOpen(true,)}>
                        Rotate key
                    </button>
                </div>
            </div>

            <ConfirmModal
                open={rotateOpen()}
                title="Rotate the encryption key?"
                confirmLabel="Rotate key"
                busyLabel="Rotating…"
                loading={rotating()}
                onConfirm={() => void rotate()}
                onCancel={() => setRotateOpen(false,)}
            >
                <p class="confirm-modal__message">
                    A new key version becomes current. Every private video is re-packaged onto the new key in
                    the background (no re-encode). The old key keeps working until no video uses it, then stops.
                </p>
            </ConfirmModal>
        </section>
    );
};

export default VideoSettingsPanel;
