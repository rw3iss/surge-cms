/**
 * Backup & Restore — download the whole database, or replace it with a dump.
 *
 * The restore side is the most destructive control in the product, so the UI is
 * deliberately slower than it needs to be: the download is offered first, the
 * confirmation states plainly what is lost, and the operator has to type the
 * word. None of that is friction for its own sake — a restore overwrites the
 * user table too, so getting it wrong can lock the operator out of their own
 * site.
 */
import type { BackupSettings, } from '@sitesurge/types';
import { Component, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import { FormField, } from '../forms';
import Toggle from '../common/Toggle';
import ModalShell from '../common/ModalShell';
import './BackupRestorePanel.scss';

/** Typed to enable the restore. Deliberately not the site name — a word the
 *  operator cannot produce by muscle memory or autocomplete. */
const CONFIRM_WORD = 'REPLACE';

const formatBytes = (n: number,) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1,)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1,)} MB`;
    return `${(n / 1024 ** 3).toFixed(2,)} GB`;
};

const BackupRestorePanel: Component = () => {
    const toast = useToast();

    const [tooling] = createResource(async () => {
        try { return await cms.settings.backupStatus(); } catch { return null; }
    },);

    const [downloading, setDownloading,] = createSignal(false,);
    const [file, setFile,] = createSignal<File | null>(null,);
    const [confirmOpen, setConfirmOpen,] = createSignal(false,);
    const [typed, setTyped,] = createSignal('',);
    const [restoring, setRestoring,] = createSignal(false,);
    const [result, setResult,] = createSignal<{ warnings: string[]; migrationsApplied: string[]; } | null>(null,);
    /** Set once the operator downloads a backup in this session, so the
     *  confirmation can stop nagging about it. */
    const [downloadedThisSession, setDownloadedThisSession,] = createSignal(false,);

    const download = () => {
        setDownloading(true,);
        // A plain navigation rather than fetch(): the response can be gigabytes,
        // and the browser streams it to disk instead of through the page's heap.
        window.location.href = cms.settings.backupUrl('custom',);
        setDownloadedThisSession(true,);
        // There is no load event for a download, so re-enable on a timer. The
        // server has already produced the file by the time the stream starts.
        setTimeout(() => setDownloading(false,), 4000,);
    };

    const doRestore = async () => {
        const f = file();
        if (!f || typed() !== CONFIRM_WORD) return;
        setRestoring(true,);
        try {
            const res = await cms.settings.restoreBackup(f, CONFIRM_WORD,);
            setResult({ warnings: res.warnings, migrationsApplied: res.migrationsApplied, },);
            setConfirmOpen(false,);
            setTyped('',);
            setFile(null,);
            toast.success('Database restored. Reloading…',);
            // The session, the settings and every cached list now belong to a
            // database that no longer exists — a full reload is the only
            // honest way to show what is actually there now.
            setTimeout(() => window.location.reload(), 2500,);
        } catch (e: any) {
            toast.error(e?.message || 'Restore failed.',);
            setConfirmOpen(false,);
        } finally {
            setRestoring(false,);
        }
    };

    // ─── Destination ───
    const [dest, setDest,] = createSignal<BackupSettings | null>(null,);
    const [savingDest, setSavingDest,] = createSignal(false,);
    const [testing, setTesting,] = createSignal(false,);
    const [running, setRunning,] = createSignal(false,);

    onMount(async () => {
        try {
            const d = await cms.settings.getBackupDestination() as BackupSettings;
            setDest(d,);
            if (d.destination !== 'download') await loadStored();
        } catch { /* error bus */ }
    },);

    /** Patch one field without losing the rest of the shape. */
    const patch = (p: Partial<BackupSettings>,) => setDest({ ...(dest() as BackupSettings), ...p, },);
    const patchS3 = (p: Partial<BackupSettings['s3']>,) =>
        patch({ s3: { ...(dest()!.s3 ?? {}), ...p, } as BackupSettings['s3'], },);
    const patchSchedule = (p: Partial<BackupSettings['schedule']>,) =>
        patch({ schedule: { ...(dest()!.schedule ?? {}), ...p, } as BackupSettings['schedule'], },);

    const [stored, setStored,] = createSignal<Array<{ id: string; filename: string; bytes: number; createdAt: string; }>>([],);
    const [restoringId, setRestoringId,] = createSignal<string | null>(null,);

    const loadStored = async () => {
        try { setStored(await cms.settings.listBackups() as never,); } catch { /* error bus */ }
    };

    /** Restore from a stored backup. Guarded by the same typed confirmation as
     *  the upload path — this replaces the entire live database. */
    const restoreStored = async (id: string, filename: string,) => {
        const typed = window.prompt(
            `This REPLACES the entire live database with ${filename}. This cannot be undone.\n\nType REPLACE to confirm:`,
        );
        if (typed !== 'REPLACE') return;
        setRestoringId(id,);
        try {
            await cms.settings.restoreFromDestination(id,);
            toast.success('Database restored. Reload the admin.',);
        } catch { /* error bus */ } finally { setRestoringId(null,); }
    };

    const saveDest = async () => {
        setSavingDest(true,);
        try {
            await cms.settings.setBackupDestination(dest() as never,);
            toast.success('Backup destination saved.',);
        } catch { /* error bus */ } finally { setSavingDest(false,); }
    };

    const testDest = async () => {
        setTesting(true,);
        try {
            const r = await cms.settings.testBackupDestination();
            if (r.ok) toast.success(r.detail || 'Destination is writable.',);
            else toast.error(r.detail || 'Destination test failed.',);
        } catch { /* error bus */ } finally { setTesting(false,); }
    };

    const runNow = async () => {
        setRunning(true,);
        try {
            const r = await cms.settings.runBackup();
            toast.success(`Backup stored: ${r.location} (${Math.round(r.bytes / 1024,)} KB)`,);
            await loadStored();
        } catch { /* error bus */ } finally { setRunning(false,); }
    };

    return (
        <div class="backup-panel">
            <Show when={tooling() && !tooling()!.available}>
                <div class="backup-panel__blocker">
                    <strong>Backups are unavailable on this server.</strong>
                    <p>
                        The PostgreSQL client tools (<code>pg_dump</code>) are not installed or not
                        reachable. Install them on the server to enable backup and restore.
                    </p>
                    <p class="backup-panel__detail">{tooling()!.detail}</p>
                </div>
            </Show>

            {/* ─── Where backups are stored ─────────────────────────────── */}
            <Show when={dest()}>
                {(d,) => (
                    <div class="backup-panel__section">
                        <h3>Backup destination</h3>
                        <p class="form-help">
                            Where a backup is stored when you run one. <strong>Download only</strong>
                            keeps the current behaviour — nothing is stored, you pull a copy
                            through the browser.
                        </p>

                        <FormField label="Destination">
                            <select
                                value={d().destination}
                                onChange={(e,) => patch({ destination: e.currentTarget.value as never, },)}
                            >
                                <option value="download">Download only (nothing stored)</option>
                                <option value="local">Server folder</option>
                                <option value="s3">S3-compatible (AWS S3, Cloudflare R2, Backblaze, MinIO)</option>
                            </select>
                        </FormField>

                        <Show when={d().destination === 'local'}>
                            <FormField
                                label="Folder"
                                hint="Absolute path on the server. Avoid /tmp — most systems clear it on reboot."
                            >
                                <input
                                    type="text"
                                    value={d().local?.path ?? ''}
                                    placeholder="/var/backups/sitesurge"
                                    onBlur={(e,) => patch({ local: { path: e.currentTarget.value, }, },)}
                                />
                            </FormField>
                        </Show>

                        <Show when={d().destination === 's3'}>
                            <FormField
                                label="Endpoint"
                                hint="Required for R2 and other S3-compatible stores. Leave blank for AWS S3."
                            >
                                <input
                                    type="text"
                                    value={d().s3?.endpoint ?? ''}
                                    placeholder="https://<account-id>.r2.cloudflarestorage.com"
                                    onBlur={(e,) => patchS3({ endpoint: e.currentTarget.value, },)}
                                />
                            </FormField>
                            <div class="admin-form-row-2">
                                <FormField label="Bucket">
                                    <input
                                        type="text"
                                        value={d().s3?.bucket ?? ''}
                                        onBlur={(e,) => patchS3({ bucket: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField label="Region" hint="Use `auto` for Cloudflare R2.">
                                    <input
                                        type="text"
                                        value={d().s3?.region ?? ''}
                                        placeholder="auto"
                                        onBlur={(e,) => patchS3({ region: e.currentTarget.value, },)}
                                    />
                                </FormField>
                            </div>
                            <FormField label="Folder prefix" hint="Optional, e.g. db-backups.">
                                <input
                                    type="text"
                                    value={d().s3?.prefix ?? ''}
                                    placeholder="db-backups"
                                    onBlur={(e,) => patchS3({ prefix: e.currentTarget.value, },)}
                                />
                            </FormField>
                            <div class="admin-form-row-2">
                                <FormField label="Access key ID">
                                    <input
                                        type="text"
                                        value={d().s3?.accessKeyId ?? ''}
                                        onBlur={(e,) => patchS3({ accessKeyId: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <FormField
                                    label="Secret access key"
                                    hint="Stored server-side and never sent back to the browser."
                                >
                                    <input
                                        type="password"
                                        value={d().s3?.secretAccessKey ?? ''}
                                        onBlur={(e,) => patchS3({ secretAccessKey: e.currentTarget.value, },)}
                                    />
                                </FormField>
                            </div>
                        </Show>

                        <Show when={d().destination !== 'download'}>
                            <FormField
                                label="Keep backups for (days)"
                                hint="0 keeps everything. Only files this CMS created are ever removed."
                            >
                                <input
                                    type="number"
                                    min="0"
                                    value={d().retentionDays ?? 0}
                                    onBlur={(e,) => patch({ retentionDays: Number(e.currentTarget.value,) || 0, },)}
                                />
                            </FormField>
                        </Show>

                        {/* ─── Automatic backups ─── */}
                        <Show when={d().destination !== 'download'}>
                            <div class="backup-panel__subsection">
                                <Toggle
                                    checked={d().schedule?.enabled === true}
                                    onChange={(next,) => patchSchedule({ enabled: next, },)}
                                    label="Run backups automatically"
                                />
                                <Show when={d().schedule?.enabled}>
                                    <div class="admin-form-row-2">
                                        <FormField label="Frequency">
                                            <select
                                                value={d().schedule?.frequency ?? 'daily'}
                                                onChange={(e,) => patchSchedule({ frequency: e.currentTarget.value as never, },)}
                                            >
                                                <option value="daily">Daily</option>
                                                <option value="weekly">Weekly</option>
                                                <option value="monthly">Monthly</option>
                                            </select>
                                        </FormField>
                                        <FormField label="Time" hint="Wall clock — stays put across daylight-saving changes.">
                                            <input
                                                type="time"
                                                value={(d().schedule?.timeOfDay ?? '02:00').slice(0, 5,)}
                                                onChange={(e,) => patchSchedule({ timeOfDay: e.currentTarget.value, },)}
                                            />
                                        </FormField>
                                    </div>
                                    <FormField label="Time zone" hint="IANA name, e.g. America/New_York.">
                                        <input
                                            type="text"
                                            value={d().schedule?.timezone ?? 'UTC'}
                                            placeholder="UTC"
                                            onBlur={(e,) => patchSchedule({ timezone: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                    <p class="form-help">
                                        <Show when={d().nextRunAt} fallback={<>Save to schedule the first run.</>}>
                                            Next run: <strong>{new Date(d().nextRunAt!,).toLocaleString()}</strong>
                                        </Show>
                                        <Show when={d().lastRunAt}>
                                            {' · '}Last run: {new Date(d().lastRunAt!,).toLocaleString()}{' '}
                                            <strong>{d().lastStatus === 'ok' ? 'succeeded' : 'FAILED'}</strong>
                                            <Show when={d().lastStatus === 'failed' && d().lastError}>
                                                {' — '}{d().lastError}
                                            </Show>
                                        </Show>
                                    </p>
                                </Show>
                            </div>
                        </Show>

                        <div class="backup-panel__actions">
                            <button
                                type="button"
                                class="ui-button ui-button--primary"
                                disabled={savingDest()}
                                onClick={saveDest}
                            >
                                {savingDest() ? 'Saving…' : 'Save destination'}
                            </button>
                            <Show when={d().destination !== 'download'}>
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary"
                                    disabled={testing()}
                                    onClick={testDest}
                                >
                                    {testing() ? 'Testing…' : 'Test connection'}
                                </button>
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary"
                                    disabled={running() || tooling()?.available === false}
                                    onClick={runNow}
                                >
                                    {running() ? 'Backing up…' : 'Back up now'}
                                </button>
                            </Show>
                        </div>
                        <p class="form-help backup-panel__note">
                            A backup contains every password hash and API key on the site. Treat
                            the destination as you would the database itself.
                        </p>

                        <Show when={d().destination !== 'download' && stored().length > 0}>
                            <div class="backup-panel__subsection">
                                <h4>Stored backups</h4>
                                <table class="admin-table">
                                    <tbody>
                                        <For each={stored()}>
                                            {(b,) => (
                                                <tr>
                                                    <td>{b.filename}</td>
                                                    <td>{(b.bytes / 1024 / 1024).toFixed(2)} MB</td>
                                                    <td>{new Date(b.createdAt,).toLocaleString()}</td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="ui-button ui-button--sm ui-button--danger"
                                                            disabled={restoringId() !== null}
                                                            onClick={() => restoreStored(b.id, b.filename,)}
                                                        >
                                                            {restoringId() === b.id ? 'Restoring…' : 'Restore'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </Show>
                    </div>
                )}
            </Show>

            <div class="backup-panel__section">
                <h3>Download a backup</h3>
                <p class="form-help">
                    A complete copy of the site database — pages, posts, media records, users,
                    orders and settings. Keep it somewhere safe: it also contains password
                    hashes and customer details.
                </p>
                <button
                    type="button"
                    class="ui-button ui-button--primary"
                    disabled={downloading() || tooling()?.available === false}
                    onClick={download}
                >
                    {downloading() ? 'Preparing…' : 'Download database backup'}
                </button>
                <p class="form-help backup-panel__note">
                    Large sites take a few seconds to prepare before the download starts.
                    Uploaded files (images, documents) are <strong>not</strong> included — they
                    live in storage, not the database.
                </p>
            </div>

            <div class="backup-panel__section backup-panel__section--danger">
                <h3>Restore from a backup</h3>
                <p class="form-help">
                    Replaces <strong>everything</strong> currently in the database with the
                    contents of the uploaded file. There is no undo from the admin.
                </p>

                <label class="backup-panel__file">
                    <input
                        type="file"
                        accept=".dump,.sql,.backup,application/octet-stream"
                        onChange={(e,) => setFile(e.currentTarget.files?.[0] ?? null,)}
                    />
                </label>

                <Show when={file()}>
                    <p class="backup-panel__filemeta">
                        Selected: <strong>{file()!.name}</strong> ({formatBytes(file()!.size,)})
                    </p>
                </Show>

                <button
                    type="button"
                    class="ui-button ui-button--danger"
                    disabled={!file() || tooling()?.available === false}
                    onClick={() => { setTyped('',); setConfirmOpen(true,); }}
                >
                    Restore this backup…
                </button>
            </div>

            <Show when={result()}>
                <div class="backup-panel__result">
                    <strong>Restore complete.</strong>
                    <Show when={result()!.migrationsApplied.length > 0}>
                        <p>
                            Applied {result()!.migrationsApplied.length} migration(s) to bring the
                            restored schema up to date.
                        </p>
                    </Show>
                    <Show when={result()!.warnings.length > 0}>
                        <ul>
                            <For each={result()!.warnings}>{(w,) => <li>{w}</li>}</For>
                        </ul>
                    </Show>
                </div>
            </Show>

            {/* The confirmation carries the whole warning. It is long on purpose:
                every line names something the operator loses, and the download
                offer is repeated here because this is the last useful moment. */}
            <ModalShell
                open={confirmOpen()}
                size="md"
                showClose
                dismissOnBackdrop={false}
                onClose={() => setConfirmOpen(false,)}
                ariaLabel="Confirm database restore"
                class="backup-confirm"
            >
                <div class="backup-confirm__body">
                    <h2>Replace the entire live database?</h2>

                    <p class="backup-confirm__lede">
                        This will <strong>permanently delete all current content</strong> and
                        replace it with <strong>{file()?.name}</strong>.
                    </p>

                    <ul class="backup-confirm__list">
                        <li>Every page, post, campaign, form and form submission</li>
                        <li>All shop products, orders and customer records</li>
                        <li>
                            <strong>All user accounts and passwords</strong> — including yours. If
                            this backup came from a different site, you will be signed out and
                            unable to sign back in.
                        </li>
                        <li>All settings, API keys and site appearance</li>
                    </ul>

                    <div class="backup-confirm__notices">
                        <p>
                            <strong>Uploaded files are not restored.</strong> Images and documents
                            live in storage, not the database, so a restored older copy may point at
                            files that no longer exist.
                        </p>
                        <p>
                            The server keeps a safety copy of the current database on disk before
                            it starts, but recovering from it needs server access — it is not
                            something you can undo from this screen.
                        </p>
                    </div>

                    <Show
                        when={downloadedThisSession()}
                        fallback={
                            <div class="backup-confirm__recommend">
                                <strong>Download a backup of the current database first.</strong>
                                <p>Strongly recommended — this is your only easy way back.</p>
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    onClick={download}
                                >
                                    Download current database
                                </button>
                            </div>
                        }
                    >
                        <div class="backup-confirm__recommend backup-confirm__recommend--ok">
                            A backup of the current database was downloaded in this session.
                        </div>
                    </Show>

                    <label class="backup-confirm__type">
                        <span>
                            Type <code>{CONFIRM_WORD}</code> to confirm
                        </span>
                        <input
                            type="text"
                            value={typed()}
                            autocomplete="off"
                            spellcheck={false}
                            placeholder={CONFIRM_WORD}
                            onInput={(e,) => setTyped(e.currentTarget.value,)}
                        />
                    </label>

                    <div class="backup-confirm__actions">
                        <button
                            type="button"
                            class="ui-button ui-button--danger"
                            disabled={typed() !== CONFIRM_WORD || restoring()}
                            onClick={doRestore}
                        >
                            {restoring() ? 'Restoring — do not close this tab…' : 'Replace the database'}
                        </button>
                        <button
                            type="button"
                            class="ui-button ui-button--ghost"
                            disabled={restoring()}
                            onClick={() => setConfirmOpen(false,)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </ModalShell>
        </div>
    );
};

export default BackupRestorePanel;
