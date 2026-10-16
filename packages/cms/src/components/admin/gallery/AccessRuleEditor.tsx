/**
 * "Restrict access" block for a gallery collection or item: a switch, then the
 * roles and subscription levels that may view. Shared by `CollectionPanel` and
 * `GalleryItemPanel`.
 *
 * The rule is ACTIVE only when the switch is on AND something is chosen
 * (`isGalleryAccessRuleActive`); otherwise it inherits — an item falls back to
 * its collection's rule, then to the visibility / gallery access.
 */
import type { GalleryAccessRule, } from '@sitesurge/types';
import { isGalleryAccessRuleActive, } from '@sitesurge/types';
import { Show, } from 'solid-js';
import { MultiSelect, type MultiSelectOption, } from '../../ui/MultiSelect';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';

export interface AccessRuleEditorProps {
    value: GalleryAccessRule;
    onChange: (next: GalleryAccessRule,) => void;
    /** Role options (`key` → label). */
    roles: MultiSelectOption[];
    /** Subscription level options (`id` → name). */
    tiers: MultiSelectOption[];
    /** Who the rule falls back to, e.g. "the gallery's access" / "the collection's access". */
    inheritsFrom?: string;
    disabled?: boolean;
}

export default function AccessRuleEditor(props: AccessRuleEditorProps,) {
    const v = () => props.value;
    const set = (patch: Partial<GalleryAccessRule>,) =>
        props.onChange({ enabled: v().enabled, roles: [...v().roles,], tierIds: [...v().tierIds,], ...patch, },);
    const inherits = () => props.inheritsFrom ?? "the gallery's access";

    return (
        <div class="gallery-access-rule">
            <Toggle
                checked={v().enabled}
                onChange={(enabled,) => set({ enabled, },)}
                label="Restrict access"
                disabled={props.disabled}
            />
            <Show when={v().enabled}>
                <FormField label="Roles" tooltip="Members holding any of these roles (main or additional) may view. Staff always can.">
                    <MultiSelect
                        options={props.roles}
                        value={v().roles}
                        onChange={(roles,) => set({ roles, },)}
                        placeholder="Any role…"
                        ariaLabel="Roles"
                        disabled={props.disabled}
                    />
                </FormField>
                <FormField label="Subscription levels" hint={`Nothing chosen = inherits ${inherits()}.`}>
                    <MultiSelect
                        options={props.tiers}
                        value={v().tierIds}
                        onChange={(tierIds,) => set({ tierIds, },)}
                        placeholder="Any subscription level…"
                        ariaLabel="Subscription levels"
                        disabled={props.disabled}
                    />
                </FormField>
                <p class="form-help-muted gallery-access-rule__state">
                    {isGalleryAccessRuleActive(v(),)
                        ? 'Only staff and viewers with a chosen role or subscription level can see this. Signed-out visitors cannot.'
                        : `Nothing chosen yet — inherits ${inherits()}.`}
                </p>
            </Show>
        </div>
    );
}
