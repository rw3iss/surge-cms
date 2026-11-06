/**
 * Settings → AI. The default provider (the claude-broker plugin or the
 * Anthropic API), the Anthropic key + model, the broker's pools at a glance
 * (configured in the plugin), and a test prompt showing the standard
 * `AiResult`. Guide: docs/how-it-works/AI.md.
 */
import { A, } from '@solidjs/router';
import { createSignal, For, onMount, Show, type Component, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { AiProviderKey, AiResult, AiSettings, AiStatusResponse, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import { CommitInput, FormField, } from '../forms';
import './AiSettingsPanel.scss';

const AiSettingsPanel: Component = () => {
    const toast = useToast();
    const [s, setS,] = createStore<AiSettings>({ defaultProvider: 'broker', anthropic: { apiKey: '', model: '', maxTokens: 4096, }, },);
    const [status, setStatus,] = createSignal<AiStatusResponse | null>(null,);
    const [statusError, setStatusError,] = createSignal<string | null>(null,);
    const [saving, setSaving,] = createSignal(false,);
    const [prompt, setPrompt,] = createSignal('Reply with the single word: pong',);
    const [testProvider, setTestProvider,] = createSignal<AiProviderKey | ''>('',);
    const [testPool, setTestPool,] = createSignal('',);
    const [testJson, setTestJson,] = createSignal(false,);
    const [running, setRunning,] = createSignal(false,);
    const [result, setResult,] = createSignal<AiResult | null>(null,);
    /** null = still loading; false = no `ai:manage` (the provider form is read-only). */
    const [canManage, setCanManage,] = createSignal<boolean | null>(null,);
    let cancelled = false;
    let keyEl: HTMLInputElement | undefined;

    const loadStatus = async () => {
        try {
            setStatus(await cms.ai.status(),);
            setStatusError(null,);
        } catch (e) {
            setStatusError(e instanceof Error ? e.message : 'Could not read the AI status.',);
        }
    };

    onMount(async () => {
        try {
            setS(await cms.ai.settings(),);
            setCanManage(true,);
        } catch {
            setCanManage(false,); // no ai:manage — show the status + test prompt only
        }
        void loadStatus();
    },);

    const save = async () => {
        setSaving(true,);
        try {
            setS(await cms.ai.updateSettings({
                defaultProvider: s.defaultProvider,
                anthropic: { apiKey: keyEl?.value ?? s.anthropic.apiKey, model: s.anthropic.model, maxTokens: s.anthropic.maxTokens, },
            },),);
            toast.success('AI settings saved.',);
            void loadStatus();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the AI settings.',);
        } finally {
            setSaving(false,);
        }
    };

    /** Send the test prompt; a broker job still running after the HTTP wait is polled. */
    const run = async () => {
        setRunning(true,);
        setResult(null,);
        cancelled = false;
        try {
            let r = await cms.ai.query({
                prompt: prompt(),
                provider: testProvider() || undefined,
                pool: testPool() || undefined,
                format: testJson() ? 'json' : 'text',
                kind: 'TEST',
            },);
            setResult(r,);
            for (let i = 0; i < 10 && r.timedOut && r.id && !cancelled; i++) {
                r = await cms.ai.job(r.id, { wait: 50, },);
                if (!cancelled) setResult(r,);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The request failed.',);
        } finally {
            setRunning(false,);
        }
    };

    /** Stop waiting and cancel the broker job (an Anthropic request cannot be cancelled once sent). */
    const cancel = async () => {
        const r = result();
        cancelled = true;
        if (!r?.id || r.provider !== 'broker') return;
        try {
            setResult(await cms.ai.cancel(r.id,),);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not cancel the job.',);
        }
    };

    const live = (r: AiResult,) => r.status === 'pending' || r.status === 'in_progress';

    const provider = (key: AiProviderKey,) => status()?.providers.find((p,) => p.key === key,);

    return (
        <div class="ai-settings">
            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>AI provider</h2>
                    <p class="form-help-muted">
                        Where AI requests go. The <strong>Claude broker</strong> sends them to Claude Code sessions attached to a claude-broker
                        daemon (no API cost); the <strong>Anthropic API</strong> is an optional, paid alternative.
                    </p>
                </header>
                <Show when={canManage() === false}>
                    <p class="form-help-muted">You can send prompts; changing these settings needs the <code>ai:manage</code> permission.</p>
                </Show>
                <Show when={canManage()}>
                <div class="admin-form-row">
                    <FormField label="Default provider">
                        <select value={s.defaultProvider} onChange={(e,) => setS('defaultProvider', e.currentTarget.value as AiProviderKey,)}>
                            <option value="broker" selected={s.defaultProvider === 'broker'}>Claude broker (plugin)</option>
                            <option value="anthropic" selected={s.defaultProvider === 'anthropic'}>Anthropic API</option>
                        </select>
                    </FormField>
                </div>
                <div class="admin-form-row">
                    <FormField label="Anthropic API key" hint="Optional. Kept secret; leave as is to keep the saved key. ANTHROPIC_API_KEY (env) wins.">
                        <input ref={keyEl} type="password" autocomplete="new-password" value={s.anthropic.apiKey} placeholder="sk-ant-…" />
                    </FormField>
                    <FormField label="Model">
                        <CommitInput value={s.anthropic.model} placeholder="claude-sonnet-5-5" onCommit={(v,) => setS('anthropic', 'model', v,)} />
                    </FormField>
                    <FormField label="Max tokens">
                        <CommitInput type="number" min={1} max={64000} value={String(s.anthropic.maxTokens,)} onCommit={(v,) => setS('anthropic', 'maxTokens', Number(v,) || 4096,)} />
                    </FormField>
                </div>
                <div class="ai-settings__actions">
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={saving()} onClick={() => void save()}>
                        {saving() ? 'Saving…' : 'Save AI settings'}
                    </button>
                </div>
                </Show>
            </section>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Claude broker</h2>
                    <p class="form-help-muted">
                        Pools and the broker address are set in the <A href="/admin/plugins/claude-broker">claude-broker plugin</A>.
                        A pool is a session label; its sessions are labelled <code>name</code> or <code>name-1</code>, <code>name-2</code>…
                    </p>
                </header>
                <Show when={statusError()}>
                    <p class="ai-settings__error">{statusError()}</p>
                </Show>
                <Show when={status()}>
                    {(st,) => (
                        <>
                            <ul class="ai-settings__providers">
                                <For each={st().providers}>
                                    {(p,) => (
                                        <li>
                                            <span class={`ai-settings__dot ${p.available ? 'is-ok' : 'is-off'}`} />
                                            <strong>{p.label}</strong>
                                            {p.key === st().defaultProvider ? ' (default)' : ''}
                                            {' — '}
                                            {p.available ? 'ready' : p.reason}
                                        </li>
                                    )}
                                </For>
                            </ul>
                            <Show when={st().broker.reachable}>
                                <p class="form-help-muted">Broker {st().broker.version} · {st().broker.sessionCount} session(s) attached.</p>
                            </Show>
                            <Show when={st().pools.length}>
                                <table class="ai-settings__pools">
                                    <thead>
                                        <tr><th>Pool</th><th>Ready</th><th>Busy</th><th>Idle</th><th>For</th></tr>
                                    </thead>
                                    <tbody>
                                        <For each={st().pools}>
                                            {(p,) => (
                                                <tr>
                                                    <td>{p.name}{p.name === st().broker.defaultPool ? ' (default)' : ''}</td>
                                                    <td
                                                        class={p.healthy ? 'is-ok' : 'is-warn'}
                                                        title={p.sessions.filter((x,) => x.healthy === false,).map((x,) => `${x.label}: ${x.state ?? 'unavailable'}`,).join('\n',) || undefined}
                                                    >
                                                        {p.ready ?? p.attached}/{p.expected}
                                                        {p.attached !== (p.ready ?? p.attached) ? ` (${p.attached} attached)` : ''}
                                                    </td>
                                                    <td>{p.busy}</td>
                                                    <td>{p.idle}</td>
                                                    <td>{p.description}</td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </Show>
                        </>
                    )}
                </Show>
                <div class="ai-settings__actions">
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => void loadStatus()}>Refresh</button>
                </div>
            </section>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Test prompt</h2>
                    <p class="form-help-muted">Sends a prompt and shows the standard result every AI request returns.</p>
                </header>
                <div class="admin-form-row">
                    <FormField label="Provider">
                        <select value={testProvider()} onChange={(e,) => setTestProvider(e.currentTarget.value as AiProviderKey | '',)}>
                            <option value="">Default</option>
                            <option value="broker" disabled={provider('broker',)?.available === false}>Claude broker</option>
                            <option value="anthropic" disabled={provider('anthropic',)?.available === false}>Anthropic API</option>
                        </select>
                    </FormField>
                    <FormField label="Pool" hint="Broker only.">
                        <select value={testPool()} onChange={(e,) => setTestPool(e.currentTarget.value,)}>
                            <option value="">Default pool</option>
                            <For each={status()?.pools ?? []}>{(p,) => <option value={p.name}>{p.name}</option>}</For>
                        </select>
                    </FormField>
                    <FormField label="Format">
                        <select value={testJson() ? 'json' : 'text'} onChange={(e,) => setTestJson(e.currentTarget.value === 'json',)}>
                            <option value="text">Text</option>
                            <option value="json">JSON</option>
                        </select>
                    </FormField>
                </div>
                <FormField label="Prompt">
                    <CommitInput multiline rows={3} value={prompt()} onCommit={setPrompt} onDraft={setPrompt} />
                </FormField>
                <div class="ai-settings__actions">
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={running() || !prompt().trim()} onClick={() => void run()}>
                        {running() ? 'Waiting for the answer…' : 'Send'}
                    </button>
                    <Show when={running() && result()?.provider === 'broker' && result()?.id && live(result()!,)}>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => void cancel()}>Cancel</button>
                    </Show>
                </div>
                <Show when={result()}>
                    {(r,) => (
                        <div class="ai-settings__result">
                            <p class={`ai-settings__status is-${r().status}`}>
                                {r().status}{r().timedOut ? ' (still running)' : ''} · {r().provider}
                                {r().model ? ` · ${r().model}` : ''}{r().pool ? ` · pool ${r().pool}` : ''}
                            </p>
                            <Show when={r().error}><p class="ai-settings__error">{r().error}</p></Show>
                            <Show when={r().progress.length}>
                                <ul class="ai-settings__progress">
                                    <For each={r().progress}>{(n,) => <li>{n.note}</li>}</For>
                                </ul>
                            </Show>
                            <pre>{r().data != null ? JSON.stringify(r().data, null, 2,) : r().text}</pre>
                        </div>
                    )}
                </Show>
            </section>
        </div>
    );
};

export default AiSettingsPanel;
