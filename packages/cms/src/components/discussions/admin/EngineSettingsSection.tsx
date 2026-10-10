/**
 * The discussion engine's settings (reactions, max length, edit window) as an
 * admin section. Shared by Comments → Settings and Forum → Settings, which
 * edit the SAME values — whichever page a site has (only Comments, only the
 * Forum, or both).
 */
import type { DiscussionsSettings, } from '@sitesurge/types';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import Toggle from '../../admin/common/Toggle';
import { FormField, } from '../../admin/forms';
import { parseReactions, } from './reactions';

export interface EngineSettingsSectionProps {
    value: DiscussionsSettings;
    onChange: (patch: Partial<DiscussionsSettings>,) => void;
}

const EngineSettingsSection: Component<EngineSettingsSectionProps> = (props,) => {
    // Text fields keep a local draft and commit on blur (admin input rule).
    const [reactionsText, setReactionsText,] = createSignal('',);
    const [maxLengthText, setMaxLengthText,] = createSignal('',);
    const [editWindowText, setEditWindowText,] = createSignal('',);
    createEffect(on(() => props.value, (v,) => {
        setReactionsText(v.reactions.join(' ',),);
        setMaxLengthText(String(v.maxLength,),);
        setEditWindowText(String(v.editWindowMinutes,),);
    },),);

    return (
        <section class="admin-section">
            <header class="admin-section__header">
                <h2>Discussions</h2>
                <p class="form-help-muted">Shared by Comments and the Forum.</p>
            </header>
            <div class="form-section">
                <Toggle
                    checked={props.value.reactionsEnabled}
                    onChange={(v,) => props.onChange({ reactionsEnabled: v, },)}
                    label="Reactions"
                    hint="Signed-in readers can react to comments and forum posts."
                />
                <Show when={props.value.reactionsEnabled}>
                    <FormField label="Reaction set" hint="Up to 12, separated by spaces, in display order.">
                        <input
                            type="text"
                            value={reactionsText()}
                            onInput={(e,) => setReactionsText(e.currentTarget.value,)}
                            onBlur={() => props.onChange({ reactions: parseReactions(reactionsText(),), },)}
                            onKeyDown={(e,) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        />
                    </FormField>
                </Show>
                <FormField label="Maximum length" hint="Characters per comment or forum post (100–50 000).">
                    <input
                        type="number"
                        min="100"
                        max="50000"
                        value={maxLengthText()}
                        onInput={(e,) => setMaxLengthText(e.currentTarget.value,)}
                        onBlur={() => props.onChange({ maxLength: Number(maxLengthText(),) || props.value.maxLength, },)}
                        onKeyDown={(e,) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                </FormField>
                <FormField label="Edit window (minutes)" hint="How long authors may edit after posting. 0 = always.">
                    <input
                        type="number"
                        min="0"
                        value={editWindowText()}
                        onInput={(e,) => setEditWindowText(e.currentTarget.value,)}
                        onBlur={() => props.onChange({ editWindowMinutes: Math.max(0, Number(editWindowText(),) || 0,), },)}
                        onKeyDown={(e,) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                </FormField>
            </div>
        </section>
    );
};

export default EngineSettingsSection;
