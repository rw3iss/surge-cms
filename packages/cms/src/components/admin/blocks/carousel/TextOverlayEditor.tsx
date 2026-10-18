/**
 * A carousel item's text overlay (header / subheader) and action-button
 * editors — split out of HeroContentEditor.tsx.
 */
import type { HeroActionConfig, HeroButtonSize, HeroItem, HeroTextConfig, } from '@sitesurge/types';
import { For, Show, } from 'solid-js';
import ColorPicker from '../../appearance/ColorPicker';
import Toggle from '../../common/Toggle';
import { HEADING_SIZES, TextInput, } from './heroItemUtils';

/** Patch one item (the editor's `updateItem`). */
export type UpdateItem = (id: string, updater: (item: HeroItem,) => HeroItem,) => void;

export const TextOverlaySection = (props: { item: HeroItem; field: 'header' | 'subheader'; label: string; updateItem: UpdateItem; },) => {
    const { field, label, } = props;
    const updateItem = props.updateItem;
    // Getters: this is a component now (was a render function re-run inline),
    // so reads must stay reactive.
    const config = () => props.item[field] as HeroTextConfig | undefined;
    return (
        <div class="hero-item-card__section">
            <Show
                when={config()}
                fallback={
                    <button
                        class="ui-button ui-button--sm ui-button--ghost"
                        onClick={() => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                [field]: {
                                    text: '',
                                    size: field === 'header' ? 'h1' : 'h3',
                                    color: '#ffffff',
                                } as HeroTextConfig,
                            }),);
                        }}
                    >
                        + Add {label}
                    </button>
                }
            >
                <div class="hero-item-card__section-header">
                    <span class="hero-item-card__section-label">{label}</span>
                    <button
                        class="btn btn--xs btn--danger-ghost"
                        onClick={() => {
                            updateItem(props.item.id, it => {
                                const updated = { ...it, };
                                delete (updated as any)[field];
                                return updated;
                            },);
                        }}
                    >
                        Remove
                    </button>
                </div>
                <TextInput
                    value={config()?.text || ''}
                    placeholder={`${label} text...`}
                    rows={2}
                    onUpdate={(val,) => {
                        updateItem(props.item.id, it => ({
                            ...it,
                            [field]: { ...it[field]!, text: val, },
                        }),);
                    }}
                />
                <div class="hero-item-card__row">
                    <select
                        class="input input--sm input--select"
                        value={config()?.size || 'h1'}
                        onChange={(e,) => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                [field]: { ...it[field]!, size: e.currentTarget.value as HeroTextConfig['size'], },
                            }),);
                        }}
                    >
                        <For each={HEADING_SIZES}>
                            {(size,) => <option value={size}>{size.toUpperCase()}</option>}
                        </For>
                    </select>
                    <ColorPicker
                        value={config()?.color || '#ffffff'}
                        onChange={(color,) => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                [field]: { ...it[field]!, color, },
                            }),);
                        }}
                    />
                </div>
            </Show>
        </div>
    );
};

export const ActionSection = (props: { item: HeroItem; updateItem: UpdateItem; },) => {
    const updateItem = props.updateItem;
    const action = () => props.item.action;
    return (
        <div class="hero-item-card__section">
            <Show
                when={action()}
                fallback={
                    <button
                        class="ui-button ui-button--sm ui-button--ghost"
                        onClick={() => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                action: {
                                    label: '',
                                    url: '',
                                    openInNewTab: false,
                                    size: 'small',
                                } as HeroActionConfig,
                            }),);
                        }}
                    >
                        + Add Action
                    </button>
                }
            >
                <div class="hero-item-card__section-header">
                    <span class="hero-item-card__section-label">Action</span>
                    <button
                        class="btn btn--xs btn--danger-ghost"
                        onClick={() => {
                            updateItem(props.item.id, it => {
                                const updated = { ...it, };
                                delete updated.action;
                                return updated;
                            },);
                        }}
                    >
                        Remove
                    </button>
                </div>
                <input
                    type="text"
                    class="input input--sm"
                    placeholder="Button label"
                    value={action()?.label || ''}
                    onChange={(e,) => {
                        updateItem(props.item.id, it => ({
                            ...it,
                            action: { ...it.action!, label: e.currentTarget.value, },
                        }),);
                    }}
                />
                <input
                    type="text"
                    class="input input--sm"
                    placeholder="URL (e.g. /donate)"
                    value={action()?.url || ''}
                    onChange={(e,) => {
                        updateItem(props.item.id, it => ({
                            ...it,
                            action: { ...it.action!, url: e.currentTarget.value, },
                        }),);
                    }}
                />
                <div class="hero-item-card__field">
                    <label class="hero-item-card__field-label">Button Size</label>
                    <select
                        class="input input--sm input--select"
                        value={action()?.size || 'small'}
                        onChange={(e,) => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                action: { ...it.action!, size: e.currentTarget.value as HeroButtonSize, },
                            }),);
                        }}
                    >
                        <option value="small">Small</option>
                        <option value="normal">Normal</option>
                        <option value="large">Large</option>
                    </select>
                </div>
                <div class="hero-item-card__toggle">
                    <Toggle
                        checked={action()?.openInNewTab || false}
                        onChange={(next,) => {
                            updateItem(props.item.id, it => ({
                                ...it,
                                action: { ...it.action!, openInNewTab: next, },
                            }),);
                        }}
                        label="Open in new tab"
                    />
                </div>
            </Show>
        </div>
    );
};
