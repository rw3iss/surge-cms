/** Host-rendered declarative config form, driven by a plugin's manifest configSchema. */
import { Component, createSignal, For, Show, } from 'solid-js';
import type { Plugin, PluginConfigField, } from '@sitesurge/types';
import Toggle from '../admin/common/Toggle';

const PluginConfigForm: Component<{
    plugin: Plugin;
    onSave: (patch: Record<string, unknown>) => Promise<void>;
}> = (props) => {
    const fields = (): PluginConfigField[] => props.plugin.manifest?.configSchema ?? [];
    const initial = (): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const f of fields()) out[f.key] = props.plugin.config[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '');
        return out;
    };
    const [values, setValues,] = createSignal<Record<string, unknown>>(initial(),);
    const [saving, setSaving,] = createSignal(false,);
    const [saved, setSaved,] = createSignal(false,);
    const [err, setErr,] = createSignal<string | null>(null,);

    const set = (key: string, v: unknown,): void => { setValues({ ...values(), [key]: v, },); setSaved(false,); };

    async function save(): Promise<void> {
        setSaving(true,); setErr(null,);
        try { await props.onSave(values(),); setSaved(true,); }
        catch (e) { setErr((e as Error).message,); }
        finally { setSaving(false,); }
    }

    return (
        <div class="plugin-config-form">
            <Show when={fields().length > 0} fallback={<p class="text-muted">This plugin has no configurable options.</p>}>
                <For each={fields()}>
                    {(f,) => (
                        <div class="form-group">
                            <label>{f.label}{f.required ? ' *' : ''}</label>
                            <Show when={f.help}><div class="form-help-muted">{f.help}</div></Show>
                            {f.type === 'boolean'
                                ? <Toggle checked={values()[f.key] === true} onChange={(next,) => set(f.key, next,)} />
                                : f.type === 'select'
                                ? (
                                    <select class="input" value={String(values()[f.key] ?? '',)} onChange={(e,) => set(f.key, e.currentTarget.value,)}>
                                        <For each={f.options ?? []}>{(o,) => <option value={o}>{o}</option>}</For>
                                    </select>
                                )
                                : f.type === 'textarea'
                                ? <textarea class="input" rows={4} value={String(values()[f.key] ?? '',)} onInput={(e,) => set(f.key, e.currentTarget.value,)} />
                                : (
                                    <input
                                        class="input"
                                        type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}
                                        value={String(values()[f.key] ?? '',)}
                                        onInput={(e,) => set(f.key, f.type === 'number' ? Number(e.currentTarget.value,) : e.currentTarget.value,)}
                                    />
                                )}
                        </div>
                    )}
                </For>
            </Show>
            <Show when={err()}><div class="alert alert-danger">{err()}</div></Show>
            <div class="form-actions">
                <button class="btn btn-primary" disabled={saving()} onClick={save}>
                    {saving() ? 'Saving…' : saved() ? 'Saved ✓' : 'Save configuration'}
                </button>
            </div>
        </div>
    );
};

export default PluginConfigForm;
