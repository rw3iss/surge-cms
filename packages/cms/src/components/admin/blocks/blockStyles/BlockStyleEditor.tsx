import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import type { SiteBreakpoint, } from '@sitesurge/types';
import { BLOCK_STYLE_DEFAULTS, BlockStyleData, } from '../../../../services/blockStyles';
import { useToast, } from '../../../common/toast/Toast';
import ColorPicker from '../../appearance/ColorPicker';
import FontSelect from '../../common/FontSelect';
import ConfirmModal from '../../common/ConfirmModal';
import Tooltip from '../../common/Tooltip';
import MediaSelectModal from '../../media/MediaSelectModal';
import MediaUploadModal from '../../media/MediaUploadModal';
import './BlockStyleEditor.scss';

interface BlockStyleEditorProps {
    style: BlockStyleData;
    onChange: (style: BlockStyleData,) => void;
    allowSaveTemplate?: boolean;
    onSaveTemplate?: (style: BlockStyleData,) => Promise<void>;
    onCopyTemplate?: () => void;
    onSetDefault?: (templateId: string,) => Promise<void>;
    /** Operator-defined responsive breakpoints (Settings → Appearance). When
     *  non-empty, a breakpoint dropdown appears and every control edits that
     *  breakpoint's override bag instead of the base style. */
    breakpoints?: SiteBreakpoint[];
}

const FONT_SIZE_OPTIONS = [
    '8px',
    '10px',
    '12px',
    '14px',
    '16px',
    '18px',
    '20px',
    '22px',
    '24px',
    '26px',
    '28px',
    '30px',
    '32px',
];

const LINE_HEIGHT_OPTIONS = ['1', '1.15', '1.25', '1.4', '1.5', '1.6', '1.75', '2', '2.5',];
const PADDING_OPTIONS = ['15px', '30px', '45px', '60px',];
const MARGIN_OPTIONS = ['auto', '15px', '30px', '45px', '60px',];

/** Sentinel dropdown value that switches padding/margin to a custom text input. */
const CUSTOM = '__custom__';

/** Check if a value is not in the preset list (i.e. it's a custom value) */
const isCustomValue = (value: string | undefined, presets: string[], defaultVal: string,): boolean => {
    if (!value || value === defaultVal) return false;
    return !presets.includes(value,);
};

const BlockStyleEditor: Component<BlockStyleEditorProps> = (props,) => {
    const toast = useToast();
    const [templateName, setTemplateName,] = createSignal(props.style.name || '',);
    const [customPadding, setCustomPadding,] = createSignal(
        isCustomValue(props.style.padding, PADDING_OPTIONS, BLOCK_STYLE_DEFAULTS.padding,),
    );
    const [customMargin, setCustomMargin,] = createSignal(
        isCustomValue(props.style.margin, MARGIN_OPTIONS, BLOCK_STYLE_DEFAULTS.margin,),
    );
    const [saving, setSaving,] = createSignal(false,);
    const [showDefaultConfirm, setShowDefaultConfirm,] = createSignal(false,);
    const [settingDefault, setSettingDefault,] = createSignal(false,);
    const [showBgSelect, setShowBgSelect,] = createSignal(false,);
    const [showBgUpload, setShowBgUpload,] = createSignal(false,);
    let lastStyleId = props.style.id;

    // Only sync template name when the style identity changes (different template loaded, or became custom)
    createEffect(() => {
        const id = props.style.id;
        if (id !== lastStyleId) {
            lastStyleId = id;
            if (!id) {
                setTemplateName('',);
            } else {
                setTemplateName(props.style.name || '',);
            }
        }
    },);

    // ─── Responsive breakpoint routing ───
    // '' = the base/default style (shown at all sizes). A breakpoint id routes
    // every control's read + write to that breakpoint's override bag, so empty
    // fields there inherit the base and only differences are stored.
    const [activeBp, setActiveBp,] = createSignal('',);
    const bpList = () => props.breakpoints ?? [];

    /** Effective value of a style field for the active editing context. */
    const sv = (field: string,): string => {
        const bp = activeBp();
        if (bp) {
            const ov = (props.style.breakpoints as Record<string, Record<string, string | null>> | undefined)?.[bp];
            return (ov?.[field] ?? '') as string;
        }
        return ((props.style as Record<string, unknown>)[field] as string | undefined) ?? '';
    };

    const update = (field: keyof BlockStyleData, value: string | undefined,) => {
        const bp = activeBp();
        if (bp) {
            // Write into the breakpoint's override bag; clearing a field removes
            // the key (so it inherits the base) rather than storing null.
            const bps = { ...(props.style.breakpoints ?? {}), } as Record<string, Record<string, string | null>>;
            const ov = { ...(bps[bp] ?? {}), };
            if (value === '' || value === undefined) delete ov[field as string];
            else ov[field as string] = value;
            if (Object.keys(ov,).length === 0) delete bps[bp];
            else bps[bp] = ov;
            props.onChange({ ...props.style, breakpoints: Object.keys(bps,).length ? bps : undefined, },);
            return;
        }
        // Base style. null (not undefined) for a clear so the key survives JSON
        // serialization and the backend writes the clear.
        props.onChange({ ...props.style, [field]: value === '' ? null : value, },);
    };

    // Recompute the preset-vs-custom toggles ONLY when the active breakpoint
    // switches (not on every edit, which would fight the manual "Custom" button).
    let lastBp = '';
    createEffect(() => {
        const bp = activeBp();
        if (bp === lastBp) return;
        lastBp = bp;
        setCustomPadding(isCustomValue(sv('padding',), PADDING_OPTIONS, BLOCK_STYLE_DEFAULTS.padding,),);
        setCustomMargin(isCustomValue(sv('margin',), MARGIN_OPTIONS, BLOCK_STYLE_DEFAULTS.margin,),);
    },);

    const handleSaveTemplate = async () => {
        if (!props.onSaveTemplate) return;
        if (props.style.id) {
            if (!confirm('This will update this style globally for all blocks using it. Continue?',)) return;
        }
        if (!templateName()) {
            toast.error('Please enter a template name',);
            return;
        }
        setSaving(true,);
        try {
            await props.onSaveTemplate({ ...props.style, name: templateName(), },);
            toast.success('Style template saved',);
        } catch {
            toast.error('Failed to save style template',);
        } finally {
            setSaving(false,);
        }
    };

    const handleReset = () => {
        if (!confirm('Reset all style properties to defaults?',)) return;
        // Clear EVERY style property, driven from the defaults key set so a
        // newly-added property can't be silently missed. (This previously hand-
        // listed a subset and left textAlign / backgroundPosition / fontFamily /
        // gap stale after a reset.)
        const cleared: Record<string, undefined> = {};
        for (const key of Object.keys(BLOCK_STYLE_DEFAULTS,)) cleared[key] = undefined;
        props.onChange({
            ...cleared,
            id: props.style.id,
            name: props.style.name,
            isDefault: props.style.isDefault,
        } as BlockStyleData,);
        setCustomPadding(false,);
        setCustomMargin(false,);
        toast.info('Style reset to defaults',);
    };

    const handleCancelCustomPadding = () => {
        update('padding', undefined,);
        setCustomPadding(false,);
    };

    const handleCancelCustomMargin = () => {
        update('margin', undefined,);
        setCustomMargin(false,);
    };

    return (
        <div class="block-style-editor">
            {/* Breakpoint selector — only when the site has custom breakpoints */}
            <Show when={bpList().length}>
                <div
                    class="block-style-editor__bp-bar"
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '0.5rem',
                        'margin-bottom': '0.75rem',
                        'padding-bottom': '0.75rem',
                        'border-bottom': '1px solid var(--admin-border, #e5e7eb)',
                    }}
                >
                    <label class="block-style-editor__label" style={{ margin: 0, }}>
                        Editing
                        <Tooltip
                            header="Responsive breakpoint"
                            content="Choose a breakpoint to set style overrides that apply only within its media query. 'Default' edits the base style shown at all sizes. Fields left empty at a breakpoint inherit the default."
                        />
                    </label>
                    <select
                        class="block-style-editor__select"
                        value={activeBp()}
                        onChange={(e,) => setActiveBp(e.currentTarget.value,)}
                    >
                        <option value="">Default (all sizes)</option>
                        <For each={bpList()}>
                            {(bp,) => <option value={bp.id}>{bp.name}</option>}
                        </For>
                    </select>
                </div>
            </Show>

            {/* Style properties */}
            <div class="block-style-editor__properties">
                {/* Background Color */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Background Color</label>
                    <div class="block-style-editor__color-row">
                        <ColorPicker
                            value={sv('backgroundColor') || ''}
                            onChange={(val,) => update('backgroundColor', val,)}
                            allowCustomValue
                            clearable
                            onClear={() => update('backgroundColor', '',)}
                        />
                    </div>
                </div>

                {/* Text Color */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Text Color</label>
                    <div class="block-style-editor__color-row">
                        <ColorPicker
                            value={sv('textColor') || BLOCK_STYLE_DEFAULTS.textColor}
                            onChange={(hex,) => update('textColor', hex,)}
                        />
                    </div>
                </div>

                {/* Background Image (full width; alignment + line height go on the row below) */}
                <div class="block-style-editor__field block-style-editor__field--full">
                    <label class="block-style-editor__label">
                        Background Image
                        <Tooltip
                            header="Background Image"
                            content="A full-bleed background for this block. It covers the block's whole box and is NOT clipped by the padding, so content still sits above it with the padding applied (the margin does inset it). When a background color is ALSO set, the image is the backdrop and the color/gradient renders as an overlay on top of it — use a translucent color or gradient to tint the image for readability."
                        />
                    </label>
                    <Show
                        when={sv('backgroundImage')}
                        fallback={
                            <div class="block-style-editor__bg-row">
                                <span class="block-style-editor__bg-none">None</span>
                                <button
                                    class="btn btn--small btn--secondary"
                                    onClick={() => setShowBgSelect(true,)}
                                >
                                    Select Media
                                </button>
                                <button
                                    class="btn btn--small btn--outline"
                                    onClick={() => setShowBgUpload(true,)}
                                >
                                    Upload Image
                                </button>
                            </div>
                        }
                    >
                        <div class="block-style-editor__bg-row">
                            <img
                                class="block-style-editor__bg-thumb"
                                src={sv('backgroundImage')}
                                alt="Background preview"
                            />
                            <button
                                class="btn btn--small btn--secondary"
                                onClick={() => setShowBgSelect(true,)}
                            >
                                Change
                            </button>
                            <button
                                class="btn btn--small btn--outline"
                                onClick={() => setShowBgUpload(true,)}
                            >
                                Upload
                            </button>
                            <button
                                class="btn btn--small btn--danger"
                                onClick={() => update('backgroundImage', '',)}
                            >
                                Remove
                            </button>
                        </div>
                    </Show>
                </div>

                {/* Background Position — only relevant when a background image is set */}
                <Show when={sv('backgroundImage')}>
                    <div class="block-style-editor__field block-style-editor__field--full">
                        <label class="block-style-editor__label">
                            Background Position
                            <Tooltip
                                header="CSS Background Position"
                                content="How the background image is positioned within the block. Any valid CSS background-position value: 'center', 'center center', 'center 100%', 'top left', '50% 25%', etc. Defaults to 'center'."
                            />
                        </label>
                        <div class="block-style-editor__field-right">
                            <div class="block-style-editor__custom-input-row">
                                <input
                                    type="text"
                                    class="block-style-editor__custom-input"
                                    value={sv('backgroundPosition') || ''}
                                    onChange={(e,) => update('backgroundPosition', e.currentTarget.value,)}
                                    placeholder="e.g. center, center 100%, top left"
                                />
                            </div>
                        </div>
                    </div>
                </Show>

                {/* Text Alignment */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Text Alignment</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('textAlign') || BLOCK_STYLE_DEFAULTS.textAlign}
                        onChange={(e,) => update('textAlign', e.currentTarget.value,)}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="justify">Justify</option>
                    </select>
                </div>

                {/* Line Height */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Line Height</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('lineHeight') || BLOCK_STYLE_DEFAULTS.lineHeight}
                        onChange={(e,) => update('lineHeight', e.currentTarget.value,)}
                    >
                        <option value={BLOCK_STYLE_DEFAULTS.lineHeight}>Default</option>
                        <For each={LINE_HEIGHT_OPTIONS}>
                            {(lh,) => <option value={lh}>{lh}</option>}
                        </For>
                    </select>
                </div>

                {/* Font Size */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Font Size</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('fontSize') || BLOCK_STYLE_DEFAULTS.fontSize}
                        onChange={(e,) => update('fontSize', e.currentTarget.value,)}
                    >
                        <option value={BLOCK_STYLE_DEFAULTS.fontSize}>Default ({BLOCK_STYLE_DEFAULTS.fontSize})</option>
                        <For each={FONT_SIZE_OPTIONS}>
                            {(size,) => <option value={size}>{size}</option>}
                        </For>
                    </select>
                </div>

                {/* Font */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Font</label>
                    <FontSelect
                        value={sv('fontFamily') || ''}
                        onChange={(v,) => update('fontFamily', v,)}
                        noneLabel="Default (site font)"
                    />
                </div>

                {/* Width — a free CSS-value input (matches Max Width). `full`
                    (and legacy `none`) resolve to 100% in the renderer via
                    normalizeCssWidth, so "fill the container" still has a word. */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Width
                        <Tooltip
                            header="CSS Width"
                            content="Any CSS length: %, px, vw, rem, em, auto, full (= 100%), max-content, min-content, or calc() expressions."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={sv('width') || ''}
                                onChange={(e,) => update('width', e.currentTarget.value,)}
                                placeholder="e.g. full, 50%, 300px"
                            />
                        </div>
                    </div>
                </div>

                {/* Max Width */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Max Width
                        <Tooltip
                            header="CSS Max Width"
                            content="Caps how wide the block can grow. Any CSS length: %, px, vw, rem, em, none, max-content, min-content, or calc()."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={sv('maxWidth') || ''}
                                onChange={(e,) => update('maxWidth', e.currentTarget.value,)}
                                placeholder="e.g. 640px, 80%"
                            />
                        </div>
                    </div>
                </div>

                {/* Min Height (before Height) */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Min Height
                        <Tooltip
                            header="CSS Min Height"
                            content="Minimum height the block won't shrink below. Any CSS length: px, vh, rem, em, % or calc()."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={sv('minHeight') || ''}
                                onChange={(e,) => update('minHeight', e.currentTarget.value,)}
                                placeholder="e.g. 200px, 40vh"
                            />
                        </div>
                    </div>
                </div>

                {/* Height */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Height</label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={sv('height') || ''}
                                onChange={(e,) => update('height', e.currentTarget.value,)}
                                placeholder="e.g. 300px, 50vh"
                            />
                        </div>
                    </div>
                </div>

                {/* Vertical Alignment (after Height) */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Vertical Alignment</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('verticalAlign') || BLOCK_STYLE_DEFAULTS.verticalAlign}
                        onChange={(e,) => update('verticalAlign', e.currentTarget.value,)}
                    >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                    </select>
                </div>

                {/* Horizontal Alignment (after Vertical Alignment) */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Horizontal Alignment
                        <Tooltip
                            header="Horizontal Alignment"
                            content="How the block's items are distributed horizontally (justify-content) — most visible on multi-item blocks like Social or a multi-image block."
                        />
                    </label>
                    <select
                        class="block-style-editor__select"
                        value={sv('horizontalAlign') || ''}
                        onChange={(e,) => update('horizontalAlign', e.currentTarget.value || undefined,)}
                    >
                        <option value="">Default</option>
                        <option value="start">Start</option>
                        <option value="center">Center</option>
                        <option value="end">End</option>
                        <option value="space-between">Space between</option>
                        <option value="space-around">Space around</option>
                        <option value="space-evenly">Space evenly</option>
                        <option value="stretch">Stretch</option>
                    </select>
                </div>

                {/* Padding */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Padding
                        <Tooltip
                            header="Padding"
                            content="Space inside the content block (between its edge and its content). Valid: px, rem, em, %, or shorthand like '10px 20px 10px 20px'."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <Show
                            when={!customPadding()}
                            fallback={
                                <div class="block-style-editor__custom-input-row">
                                    <input
                                        type="text"
                                        class="block-style-editor__custom-input block-style-editor__custom-input--short"
                                        value={sv('padding') || ''}
                                        onChange={(e,) => update('padding', e.currentTarget.value,)}
                                        placeholder="e.g. 10px 20px"
                                    />
                                    <button
                                        type="button"
                                        class="block-style-editor__custom-clear"
                                        title="Remove custom value"
                                        aria-label="Remove custom value"
                                        onClick={handleCancelCustomPadding}
                                    >
                                        ×
                                    </button>
                                </div>
                            }
                        >
                            <select
                                class="block-style-editor__select"
                                value={sv('padding') || BLOCK_STYLE_DEFAULTS.padding}
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    if (v === CUSTOM) { setCustomPadding(true,); return; }
                                    update('padding', v,);
                                }}
                            >
                                <option value={BLOCK_STYLE_DEFAULTS.padding}>
                                    Default ({BLOCK_STYLE_DEFAULTS.padding || '0'})
                                </option>
                                <For each={PADDING_OPTIONS}>
                                    {(val,) => <option value={val}>{val}</option>}
                                </For>
                                <option value={CUSTOM}>Custom…</option>
                            </select>
                        </Show>
                    </div>
                </div>

                {/* Margin */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Margin
                        <Tooltip
                            header="Margin"
                            content="Space outside the content block (between it and neighbours). Valid: px, rem, em, %, auto, or shorthand like '10px 20px 10px 20px'."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <Show
                            when={!customMargin()}
                            fallback={
                                <div class="block-style-editor__custom-input-row">
                                    <input
                                        type="text"
                                        class="block-style-editor__custom-input block-style-editor__custom-input--short"
                                        value={sv('margin') || ''}
                                        onChange={(e,) => update('margin', e.currentTarget.value,)}
                                        placeholder="e.g. 10px 0"
                                    />
                                    <button
                                        type="button"
                                        class="block-style-editor__custom-clear"
                                        title="Remove custom value"
                                        aria-label="Remove custom value"
                                        onClick={handleCancelCustomMargin}
                                    >
                                        ×
                                    </button>
                                </div>
                            }
                        >
                            <select
                                class="block-style-editor__select"
                                value={sv('margin') || BLOCK_STYLE_DEFAULTS.margin}
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    if (v === CUSTOM) { setCustomMargin(true,); return; }
                                    update('margin', v,);
                                }}
                            >
                                <option value={BLOCK_STYLE_DEFAULTS.margin}>
                                    Default ({BLOCK_STYLE_DEFAULTS.margin || '0'})
                                </option>
                                <For each={MARGIN_OPTIONS}>
                                    {(val,) => <option value={val}>{val}</option>}
                                </For>
                                <option value={CUSTOM}>Custom…</option>
                            </select>
                        </Show>
                    </div>
                </div>

                {/* Gap */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Gap
                        <Tooltip
                            header="Gap"
                            content="Spacing between the block's inner content items (e.g. a campaign or posts list). Valid: px, rem, em, vw."
                        />
                    </label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={sv('gap') || ''}
                                onChange={(e,) => update('gap', e.currentTarget.value,)}
                                placeholder="e.g. 1rem, 16px"
                            />
                        </div>
                    </div>
                </div>

                {/* Overflow X */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Overflow X</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('overflowX') || ''}
                        onChange={(e,) => update('overflowX', e.currentTarget.value || undefined,)}
                    >
                        <option value="">Default (wrap)</option>
                        <option value="auto">Scroll if needed</option>
                        <option value="scroll">Always scroll</option>
                        <option value="hidden">Hidden (clip)</option>
                    </select>
                </div>

                {/* Overflow Y */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Overflow Y</label>
                    <select
                        class="block-style-editor__select"
                        value={sv('overflowY') || ''}
                        onChange={(e,) => update('overflowY', e.currentTarget.value || undefined,)}
                    >
                        <option value="">Default (grow)</option>
                        <option value="auto">Scroll if needed</option>
                        <option value="scroll">Always scroll</option>
                        <option value="hidden">Hidden (clip)</option>
                    </select>
                </div>
            </div>

            {/* Template save section — at the bottom */}
            <Show when={props.allowSaveTemplate}>
                <div class="block-style-editor__template-section">
                    <div class="block-style-editor__template-row">
                        <input
                            type="text"
                            class="block-style-editor__template-name"
                            value={templateName()}
                            onInput={(e,) => setTemplateName(e.currentTarget.value,)}
                            placeholder="Template name..."
                        />
                        <button
                            class="btn btn--small btn--primary"
                            onClick={handleSaveTemplate}
                            disabled={saving() || !templateName()}
                        >
                            {saving() ? 'Saving...' : 'Save Template'}
                        </button>
                    </div>
                    <div class="block-style-editor__template-row block-style-editor__template-row--secondary">
                        <Show when={props.onCopyTemplate}>
                            <button class="btn btn--small btn--secondary" onClick={() => props.onCopyTemplate?.()}>
                                Copy to New
                            </button>
                        </Show>
                        <Show when={props.onSetDefault && props.style.id && !props.style.isDefault}>
                            <button
                                class="btn btn--small btn--secondary"
                                onClick={() => setShowDefaultConfirm(true,)}
                                disabled={settingDefault()}
                            >
                                {settingDefault() ? 'Setting...' : 'Set as Default'}
                            </button>
                        </Show>
                        <div class="block-style-editor__template-spacer" />
                        <button class="btn btn--small btn--ghost" onClick={handleReset}>Reset Styles</button>
                    </div>
                </div>
            </Show>

            <ConfirmModal
                open={showDefaultConfirm()}
                title="Set as Default Style"
                message={`Set "${
                    props.style.name || 'this template'
                }" as the default style for all new blocks? This will replace the current default.`}
                confirmLabel="Set as Default"
                onConfirm={async () => {
                    setShowDefaultConfirm(false,);
                    if (!props.onSetDefault || !props.style.id) return;
                    setSettingDefault(true,);
                    try {
                        await props.onSetDefault(props.style.id,);
                        toast.success('Default style updated',);
                    } catch {
                        toast.error('Failed to set default style',);
                    } finally {
                        setSettingDefault(false,);
                    }
                }}
                onCancel={() => setShowDefaultConfirm(false,)}
            />

            <Show when={showBgSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => { update('backgroundImage', media.url,); setShowBgSelect(false,); }}
                    onClose={() => setShowBgSelect(false,)}
                />
            </Show>
            <Show when={showBgUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => { update('backgroundImage', media.url,); setShowBgUpload(false,); }}
                    onClose={() => setShowBgUpload(false,)}
                />
            </Show>
        </div>
    );
};

export default BlockStyleEditor;
