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
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
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
