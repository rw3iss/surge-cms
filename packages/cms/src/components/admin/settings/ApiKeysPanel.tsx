/**
 * API Keys panel — shown under Settings → API Keys.
 *
 * Lists active and revoked keys (hash never shown), creates new keys
 * (plaintext displayed once with a Copy button), and revokes keys.
 * Headless clients send the key as `Authorization: Bearer ssk_…`.
 */
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../../services/api';

interface ApiKeyRow {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

const SCOPES = ['read', 'write', 'admin',] as const;

const ApiKeysPanel: Component = () => {
    const [keys, { refetch, },] = createResource(async () => {
        const res = await api.get<ApiKeyRow[]>('/api-keys',);
        return res.success ? (res.data ?? []) : [];
    },);

    const [name, setName,] = createSignal('',);
    const [scopes, setScopes,] = createSignal<string[]>(['read',],);
    const [creating, setCreating,] = createSignal(false,);
    const [createdKey, setCreatedKey,] = createSignal<string | null>(null,);
    const [error, setError,] = createSignal<string | null>(null,);

    const toggleScope = (s: string,) => {
        setScopes((prev,) =>
            prev.includes(s,) ? prev.filter((x,) => x !== s,) : [...prev, s,],
        );
    };

    const handleCreate = async (e: Event,) => {
        e.preventDefault();
        setError(null,);
        if (!name().trim() || scopes().length === 0) return;
        setCreating(true,);
        const res = await api.post<{ apiKey: ApiKeyRow; key: string; }>('/api-keys', {
            name: name().trim(),
            scopes: scopes(),
        },);
        setCreating(false,);
        if (res.success && res.data) {
            setCreatedKey(res.data.key,);
            setName('',);
            setScopes(['read',],);
            void refetch();
        } else {
            setError((res as any).error?.message || 'Failed to create key',);
        }
    };

    const handleRevoke = async (key: ApiKeyRow,) => {
        setError(null,);
        if (!confirm(`Revoke "${key.name}"? Clients using it will stop working immediately.`,)) return;
        const res = await api.delete(`/api-keys/${key.id}`,);
        if (res.success) {
            void refetch();
        } else {
            setError((res as any).error?.message || 'Failed to revoke key',);
        }
    };

    const fmt = (iso: string | null,) =>
        iso ? new Date(iso,).toLocaleDateString() : '—';

    return (
        <div class="settings-grid">
            <section class="settings-card">
                <h3 class="settings-card__title">Create API key</h3>
                <p class="settings-card__lede">
                    Keys authenticate headless clients (scripts, agents, integrations)
                    without a user login. Send as{' '}
                    <code>Authorization: Bearer ssk_…</code>.
                </p>

                <Show when={createdKey()}>
                    <div class="alert alert--success">
                        <strong>Copy this key now — it will not be shown again.</strong>
                        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-top': '8px', }}>
                            <code style={{ 'word-break': 'break-all', flex: '1', }}>{createdKey()}</code>
                            <button
                                type="button"
                                class="btn btn--secondary btn--sm"
                                onClick={() =>
                                    void navigator.clipboard
                                        .writeText(createdKey()!,)
                                        .catch(() => setError('Copy failed — select and copy the key manually',),)
                                }
                            >
                                Copy
                            </button>
                        </div>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class="alert alert--error">{error()}</div>
                </Show>

                <form onSubmit={handleCreate}>
                    <div class="form-group">
                        <label>Name</label>
                        <input
                            type="text"
                            placeholder="e.g. deploy-bot"
                            value={name()}
                            onInput={(e,) => setName(e.currentTarget.value,)}
                        />
                    </div>

                    <div class="form-group">
                        <label>Scopes</label>
                        <For each={SCOPES}>
                            {(s,) => (
                                <label class="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={scopes().includes(s,)}
                                        onChange={() => toggleScope(s,)}
                                    />
                                    {' '}{s}
                                </label>
                            )}
                        </For>
                        <p class="form-help-muted">
                            read &lt; write &lt; admin (hierarchical). GET endpoints need
                            read; mutations need write.
                        </p>
                    </div>

                    <button
                        type="submit"
                        class="btn btn--primary"
                        disabled={creating() || !name().trim() || scopes().length === 0}
                    >
                        {creating() ? 'Creating…' : 'Create key'}
                    </button>
                </form>
            </section>

            <section class="settings-card">
                <h3 class="settings-card__title">Existing keys</h3>
                <Show
                    when={(keys() ?? []).length > 0}
                    fallback={<p class="form-help-muted">No API keys yet.</p>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Prefix</th>
                                    <th>Scopes</th>
                                    <th>Last used</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={keys()}>
                                    {(k,) => (
                                        <tr>
                                            <td>{k.name}</td>
                                            <td><code>{k.keyPrefix}…</code></td>
                                            <td>{k.scopes.join(', ',)}</td>
                                            <td>{fmt(k.lastUsedAt,)}</td>
                                            <td>
                                                <Show
                                                    when={k.revokedAt}
                                                    fallback={
                                                        <span class="badge badge--success">Active</span>
                                                    }
                                                >
                                                    <span class="badge badge--muted">Revoked</span>
                                                </Show>
                                            </td>
                                            <td>
                                                <Show when={!k.revokedAt}>
                                                    <button
                                                        class="btn btn--danger btn--sm"
                                                        onClick={() => handleRevoke(k,)}
                                                    >
                                                        Revoke
                                                    </button>
                                                </Show>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </section>
        </div>
    );
};

export default ApiKeysPanel;
