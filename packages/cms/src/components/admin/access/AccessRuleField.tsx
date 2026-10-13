/**
 * One "who may …" rule: Public / Signed-in members / Subscription tier (+ the
 * tier), optionally with "Inherit" (a per-item override of a site default).
 * Shared by Event Settings (defaults) and the event modal (per event).
 */
import type { SubscriptionTierOption, } from '@sitesurge/types';
import { Component, For, Show, } from 'solid-js';
import { FormField, } from '../forms';
import './AccessRuleField.scss';

export type AccessRuleValue = 'inherit' | 'public' | 'members' | 'tier';

const LABELS: Record<Exclude<AccessRuleValue, 'inherit'>, string> = {
    public: 'Everyone',
    members: 'Signed-in members',
    tier: 'Members (tier and up)',
};

/** "Everyone" / "Signed-in members" / "Gold members and up" — for summaries and inherit labels. */
export function describeAccessRule(rule: AccessRuleValue, tierId: string | null | undefined, tiers: SubscriptionTierOption[],): string {
    if (rule === 'inherit') return 'Inherit';
    if (rule !== 'tier') return LABELS[rule];
    const t = tiers.find((x,) => x.id === tierId,);
    return t ? `${t.name} members and up` : 'Members';
}

export interface AccessRuleFieldProps {
    label: string;
    hint?: string;
    tooltip?: string;
    rule: AccessRuleValue;
    tierId: string | null;
    tiers: SubscriptionTierOption[];
    /** Offer "Inherit (<inheritLabel>)" first. */
    allowInherit?: boolean;
    inheritLabel?: string;
    onChange: (rule: AccessRuleValue, tierId: string | null,) => void;
}

export const AccessRuleField: Component<AccessRuleFieldProps> = (props,) => {
    const paid = () => props.tiers.filter((t,) => !t.isFree,);
    return (
        <FormField label={props.label} hint={props.hint} tooltip={props.tooltip}>
            <div class="access-rule">
                <select
                    value={props.rule}
                    onChange={(e,) => {
                        const rule = e.currentTarget.value as AccessRuleValue;
                        props.onChange(rule, rule === 'tier' ? (props.tierId ?? paid()[0]?.id ?? null) : null,);
                    }}
                >
                    <Show when={props.allowInherit}>
                        <option value="inherit">Inherit{props.inheritLabel ? ` (${props.inheritLabel})` : ''}</option>
                    </Show>
                    <option value="public">{LABELS.public}</option>
                    <option value="members">{LABELS.members}</option>
                    <option value="tier" disabled={!paid().length}>{LABELS.tier}</option>
                </select>
                <Show when={props.rule === 'tier'}>
                    <select value={props.tierId ?? ''} onChange={(e,) => props.onChange('tier', e.currentTarget.value || null,)} aria-label="Required tier">
                        <Show when={!props.tierId}><option value="">Choose a tier…</option></Show>
                        <For each={paid()}>{(t,) => <option value={t.id}>{t.name}</option>}</For>
                    </select>
                </Show>
            </div>
        </FormField>
    );
};

export default AccessRuleField;
