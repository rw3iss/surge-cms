/**
 * Server Logs panel — Settings → Admin → Server Logs.
 *
 * Collapsed by default; expanding lazy-loads the tail of the server's
 * combined log (admin-only `GET /settings/server-logs`) into a large
 * read-only textarea. The Refresh button in the header re-fetches.
 */
import type { SettingsServerLogsResponse, } from '@sitesurge/types';
import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';

const ServerLogsPanel: Component = () => {
    const [open, setOpen,] = createSignal(false,);
    const [logs, setLogs,] = createSignal<SettingsServerLogsResponse | null>(null,);
    const [loading, setLoading,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    let textareaRef: HTMLTextAreaElement | undefined;

    const load = async () => {
        setLoading(true,);
        setError('',);
        try {
            const res = await cms.settings.getServerLogs(3000,);
            setLogs(res,);
            // Jump to the newest lines (log is chronological, newest last).
            requestAnimationFrame(() => {
                if (textareaRef) textareaRef.scrollTop = textareaRef.scrollHeight;
            },);
        } catch (e) {
            setError((e as Error).message || 'Failed to load server logs',);
        } finally {
            setLoading(false,);
        }
    };

    const toggle = () => {
        const next = !open();
        setOpen(next,);
        if (next && logs() == null) void load(); // lazy first load
    };

    return (
        <div class={`collapsible-panel server-logs ${open() ? 'collapsible-panel--open' : ''}`}>
            <div class="collapsible-panel__header">
                <button
                    type="button"
                    class="collapsible-panel__header-toggle"
                    onClick={toggle}
                    aria-expanded={open()}
                >
                    <span class="collapsible-panel__icon">{open() ? '▼' : '▶'}</span>
                    <span class="collapsible-panel__title">Server Logs</span>
                </button>
                <span
                    class="collapsible-panel__header-extra"
                    onClick={(e,) => e.stopPropagation()}
                >
                    <Show when={open()}>
                        <button
                            type="button"
                            class="btn btn--small btn--secondary"
                            onClick={() => void load()}
                            disabled={loading()}
                        >
                            {loading() ? 'Refreshing…' : '↻ Refresh'}
                        </button>
                    </Show>
                </span>
            </div>

            <Show when={open()}>
                <div class="collapsible-panel__body">
                    <Show when={error()}>
                        <p class="form-help" style={{ color: 'var(--admin-error, #ef4444)', }}>{error()}</p>
                    </Show>
                    <Show when={logs() && !logs()!.available}>
                        <p class="form-help">
                            No log file found on the server. File logging is only enabled in production
                            (<code>logs/combined.log</code>); in other environments logs go to the console.
                        </p>
                    </Show>
                    <Show when={logs()?.available}>
                        <p class="form-help" style={{ 'margin-bottom': '0.5rem', }}>
                            {logs()!.file} · {(logs()!.bytes / 1024).toFixed(0)} KB
                            <Show when={logs()!.truncated}>{' · showing the most recent lines'}</Show>
                        </p>
                    </Show>
                    <textarea
                        ref={textareaRef}
                        class="server-logs__textarea"
                        readonly
                        spellcheck={false}
                        value={logs()?.content ?? (loading() ? 'Loading…' : '')}
                    />
                </div>
            </Show>
        </div>
    );
};

export default ServerLogsPanel;
