/**
 * Posts → Settings → Live Show: which live-stream provider carries the video,
 * and its credentials. The form is generated from the provider's descriptor
 * (`LiveProviderDescriptor.fields`, server registry), so a new provider needs
 * no admin UI work. Secrets arrive masked; leaving one untouched keeps it.
 */
import type { LiveProviderDescriptor, LiveProviderField, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { FormField, } from '../../forms';
import Toggle from '../../common/Toggle';

export interface LiveProviderSettingsProps {
    providers: LiveProviderDescriptor[];
    provider: string | null;
    onProviderChange: (key: string | null,) => void;
    /** Config per provider key (store, patched in place). */
    configs: Record<string, Record<string, unknown>>;
    setConfigs: SetStoreFunction<Record<string, Record<string, unknown>>>;
}

/** Text-like input with a local draft, committed on blur / Enter. */
const DraftInput: Component<{ field: LiveProviderField; value: string; onCommit: (v: string,) => void; }> = (props,) => {
    let el: HTMLInputElement | undefined;
    const [draft, setDraft,] = createSignal(props.value,);
    const commit = () => { if (draft() !== props.value) props.onCommit(draft(),); };
    return (
        <input
            ref={el}
            type={props.field.type === 'secret' ? 'password' : props.field.type === 'url' ? 'url' : 'text'}
            autocomplete={props.field.type === 'secret' ? 'new-password' : 'off'}
            placeholder={props.field.placeholder ?? (typeof props.field.default === 'string' ? props.field.default : '')}
            value={draft()}
            onFocus={() => { if (document.activeElement === el) setDraft(props.value,); }}
            onInput={(e,) => setDraft(e.currentTarget.value,)}
            onBlur={commit}
            onKeyDown={(e,) => { if (e.key === 'Enter') commit(); }}
        />
    );
};

const CAPS: { key: keyof LiveProviderDescriptor['capabilities']; label: string; }[] = [
    { key: 'browserPublish', label: 'Browser publishing', },
    { key: 'webrtcViewing', label: 'WebRTC viewing', },
    { key: 'hlsViewing', label: 'HLS viewing', },
    { key: 'recording', label: 'Recording', },
    { key: 'recordingToOwnBucket', label: 'Record to R2', },
    { key: 'guests', label: 'Guests on stage', },
];

const LiveProviderSettings: Component<LiveProviderSettingsProps> = (props,) => {
    const active = () => props.providers.find((p,) => p.key === props.provider);
    const cfg = () => (props.provider ? props.configs[props.provider] ?? {} : {});
    const valueOf = (f: LiveProviderField,): unknown => cfg()[f.key] ?? f.default;
    const set = (f: LiveProviderField, v: unknown,) => {
        const key = props.provider!;
        if (!props.configs[key]) props.setConfigs(key, {},);
        props.setConfigs(key, f.key, v,);
    };

    return (
        <section class="admin-section">
            <header class="admin-section__header">
                <h2>Live stream provider</h2>
            </header>
            <div class="form-section">
                <p class="form-help-muted">
                    Live Show posts stream the host's webcam through a provider; viewers watch from it. Chat,
                    reactions and host controls run on this site. Without a provider the live page shows a
                    placeholder stage.
                </p>
                <FormField label="Provider">
                    <select
                        value={props.provider ?? ''}
                        onChange={(e,) => props.onProviderChange(e.currentTarget.value || null,)}
                    >
                        <option value="">None</option>
                        <For each={props.providers}>
                            {(p,) => <option value={p.key}>{p.label}{p.implemented ? '' : ' (integration in progress)'}</option>}
                        </For>
                    </select>
                </FormField>

                <Show when={active()}>
                    {(p,) => (
                        <div class="live-provider">
                            <p class="live-provider__desc">
                                {p().description}{' '}
                                <a href={p().docsUrl ?? p().website} target="_blank" rel="noopener noreferrer">Docs ↗</a>
                            </p>
                            <ul class="live-provider__caps">
                                <For each={CAPS.filter((c,) => p().capabilities[c.key])}>
                                    {(c,) => <li>{c.label}</li>}
                                </For>
                            </ul>
                            <Show when={p().pricingNote}>
                                <p class="form-help-muted">{p().pricingNote}</p>
                            </Show>
                            <Show when={!p().implemented}>
                                <p class="live-provider__notice">
                                    The {p().label} connection is not built yet — these settings are saved now and used
                                    once it is.
                                </p>
                            </Show>
                            <For each={p().fields}>
                                {(f,) => (
                                    <Show
                                        when={f.type !== 'toggle'}
                                        fallback={
                                            <Toggle
                                                label={f.label}
                                                hint={f.help}
                                                checked={valueOf(f,) === true}
                                                onChange={(v,) => set(f, v,)}
                                            />
                                        }
                                    >
                                        <FormField label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help}>
                                            <Show
                                                when={f.type === 'select'}
                                                fallback={
                                                    <DraftInput
                                                        field={f}
                                                        value={String(valueOf(f,) ?? '',)}
                                                        onCommit={(v,) => set(f, v,)}
                                                    />
                                                }
                                            >
                                                <select value={String(valueOf(f,) ?? '',)} onChange={(e,) => set(f, e.currentTarget.value,)}>
                                                    <For each={f.options ?? []}>
                                                        {(o,) => <option value={o.value}>{o.label}</option>}
                                                    </For>
                                                </select>
                                            </Show>
                                        </FormField>
                                    </Show>
                                )}
                            </For>
                        </div>
                    )}
                </Show>
            </div>
        </section>
    );
};

export default LiveProviderSettings;
