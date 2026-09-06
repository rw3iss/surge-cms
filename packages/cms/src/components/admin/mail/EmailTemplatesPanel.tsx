/**
 * Email templates for one feature — the shared panel every feature's settings
 * page drops in.
 *
 * The list of editable emails comes from the MAIL_PURPOSES registry, so a
 * feature that declares a new purpose gets a toggle, a subject field, a block
 * editor and a variable reference here with no UI work. That is the whole point
 * of the registry: before it, exactly one email (member verification) was
 * editable because someone hand-built a page for it.
 *
 * ## Empty content means "use the built-in default"
 *
 * A purpose with no blocks is not a broken template — it renders the shipped
 * default body. So the editor never starts by pre-filling the default into the
 * block editor: doing that would silently convert every purpose into a custom
 * template the first time someone opened it, and they would stop receiving
 * improvements to the defaults.
 */
import { Component, createEffect, createMemo, createSignal, For, Show, } from 'solid-js';
import { MAIL_PURPOSES, type MailPurposeMeta, } from '@sitesurge/types';
import BlockEditor, { BlockData, } from '../blocks/BlockEditor';
import { backendToEditor, BackendBlock, editorToBackend, } from './blockConverters';
import { FormField, } from '../forms';
import Toggle from '../common/Toggle';
import TemplateReference from '../blocks/TemplateReference';
import './EmailTemplatesPanel.scss';

/** One purpose's stored overrides. */
export interface PurposeConfig {
    enabled?: boolean;
    subject?: string;
    blocks?: unknown[];
    autoSend?: boolean;
}

export interface EmailTemplatesPanelProps {
    /** Feature key — only that feature's purposes are shown. */
    feature: string;
    /** The whole `mail_purposes` map (all features; we read/write our slice). */
    value: Record<string, PurposeConfig>;
    onChange: (next: Record<string, PurposeConfig>,) => void;
    /** Extra purposes to include beyond the feature's own (rarely needed). */
    extraKeys?: string[];
}

const EmailTemplatesPanel: Component<EmailTemplatesPanelProps> = (props,) => {
    const purposes = createMemo(() =>
        MAIL_PURPOSES.filter((p,) =>
            p.feature === props.feature || (props.extraKeys ?? []).includes(p.key,)
        ),
    );

    const [selected, setSelected,] = createSignal('',);
    const [refOpen, setRefOpen,] = createSignal(false,);

    // Default the selection to the first purpose once the list is known.
    createEffect(() => {
        const list = purposes();
        if (list.length > 0 && !list.some((p,) => p.key === selected(),)) {
            setSelected(list[0].key,);
        }
    },);

    const meta = (): MailPurposeMeta | undefined => purposes().find((p,) => p.key === selected(),);
    const cfg = (): PurposeConfig => props.value[selected()] ?? {};

    /** Enabled falls back to the registry default, never to false. */
    const enabled = () => cfg().enabled ?? meta()?.defaultEnabled ?? false;
    const autoSend = () => cfg().autoSend ?? false;

    const patch = (change: PurposeConfig,) => {
        const key = selected();
        if (!key) return;
        props.onChange({ ...props.value, [key]: { ...cfg(), ...change, }, },);
    };

    // Stored blocks are in the BACKEND (mail_template_blocks) shape; the editor
    // wants its own. Converting here rather than in each caller is what lets a
    // feature drop this panel in without knowing either shape exists.
    const blocks = (): BlockData[] => backendToEditor((cfg().blocks ?? []) as BackendBlock[],);
    const isCustomised = () => (cfg().blocks ?? []).length > 0;

    return (
        <div class="email-templates-panel">
            <Show
                when={purposes().length > 0}
                fallback={<p class="form-help-muted">This feature doesn't send any email yet.</p>}
            >
                <FormField
                    label="Email"
                    hint="Pick which of this feature's emails to configure."
                >
                    <select value={selected()} onChange={(e,) => setSelected(e.currentTarget.value,)}>
                        <For each={purposes()}>
                            {(p,) => <option value={p.key}>{p.label}</option>}
                        </For>
                    </select>
                </FormField>

                <Show when={meta()}>
                    {(m,) => (
                        <div class="email-templates-panel__body">
                            <p class="form-help-muted email-templates-panel__desc">
                                {m().description}
                                <Show when={m().audience === 'admin'}>
                                    {' '}Recipients are the addresses configured in{' '}
                                    <strong>Settings → Notifications</strong>.
                                </Show>
                            </p>

                            <div class="email-templates-panel__toggles">
                                <Toggle
                                    label={enabled() ? 'Email enabled' : 'Email disabled'}
                                    checked={enabled()}
                                    onChange={(v,) => patch({ enabled: v, },)}
                                />
                                <Show when={m().supportsAutoSend}>
                                    <Toggle
                                        label={m().autoSendLabel ?? 'Send automatically'}
                                        checked={autoSend()}
                                        onChange={(v,) => patch({ autoSend: v, },)}
                                    />
                                </Show>
                            </div>
                            <Show when={m().supportsAutoSend && m().autoSendHelp}>
                                <p class="form-help-muted">{m().autoSendHelp}</p>
                            </Show>

                            <Show when={!enabled()}>
                                <p class="form-help-muted email-templates-panel__off">
                                    This email will not be sent while it's disabled. The template below
                                    is kept, so turning it back on restores exactly what you wrote.
                                </p>
                            </Show>

                            <FormField
                                label="Subject"
                                hint={`Supports {{variables}}. Leave blank to use: ${m().defaultSubject}`}
                            >
                                <input
                                    type="text"
                                    value={cfg().subject ?? ''}
                                    onInput={(e,) => patch({ subject: e.currentTarget.value, },)}
                                    placeholder={m().defaultSubject}
                                />
                            </FormField>

                            {/* Variables for THIS purpose, not the generic list —
                                knowing that `reset_url` exists is the difference
                                between a usable editor and guesswork. */}
                            <div class="email-templates-panel__vars">
                                <h4>Variables for this email</h4>
                                <ul>
                                    <For each={m().variables}>
                                        {(v,) => (
                                            <li>
                                                <code>{`{{${v.name}}}`}</code>
                                                <span>{v.description}</span>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </div>

                            <p class="form-help-muted">
                                <Show
                                    when={isCustomised()}
                                    fallback={<>Add blocks below to replace the built-in default body. While this is empty, the shipped default is sent.</>}
                                >
                                    This email uses your custom content. Remove every block to go back to
                                    the built-in default.
                                </Show>
                            </p>

                            <BlockEditor
                                title={`${m().label} content`}
                                blocks={blocks()}
                                onBlocksChange={(next,) => patch({ blocks: editorToBackend(next,) as unknown[], },)}
                            />

                            <section class="admin-section variables-reference-section">
                                <header class="admin-section__header variables-reference-section__header">
                                    <button
                                        type="button"
                                        class="collapsible-toggle"
                                        onClick={() => setRefOpen(!refOpen(),)}
                                    >
                                        {refOpen() ? '▼' : '▶'} Variable & Function Reference
                                    </button>
                                </header>
                                <Show when={refOpen()}>
                                    <TemplateReference />
                                </Show>
                            </section>
                        </div>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default EmailTemplatesPanel;
