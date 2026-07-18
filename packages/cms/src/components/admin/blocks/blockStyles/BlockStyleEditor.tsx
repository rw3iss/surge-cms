import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
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

const WIDTH_OPTIONS = ['100%', '66.666%', '50%', '33.333%', '25%', '20%',];
const PADDING_OPTIONS = ['15px', '30px', '45px', '60px',];
const MARGIN_OPTIONS = ['auto', '15px', '30px', '45px', '60px',];

/** Check if a value is not in the preset list (i.e. it's a custom value) */
const isCustomValue = (value: string | undefined, presets: string[], defaultVal: string,): boolean => {
    if (!value || value === defaultVal) return false;
    return !presets.includes(value,);
};

const BlockStyleEditor: Component<BlockStyleEditorProps> = (props,) => {
    const toast = useToast();
    const [templateName, setTemplateName,] = createSignal(props.style.name || '',);
    const [customWidth, setCustomWidth,] = createSignal(
        isCustomValue(props.style.width, WIDTH_OPTIONS, BLOCK_STYLE_DEFAULTS.width,),
    );
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

    const update = (field: keyof BlockStyleData, value: string | undefined,) => {
        // Use null (not undefined) for explicitly-cleared values so the key
        // survives JSON serialization and the backend can write the clear.
        // undefined would be stripped by JSON.stringify / object spread.
        props.onChange({ ...props.style, [field]: value === '' ? null : value, },);
    };

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
        props.onChange({
            id: props.style.id,
            name: props.style.name,
            isDefault: props.style.isDefault,
            backgroundColor: undefined,
            backgroundImage: undefined,
            textColor: undefined,
            fontSize: undefined,
            padding: undefined,
            verticalAlign: undefined,
            width: undefined,
            margin: undefined,
            overflowX: undefined,
            overflowY: undefined,
        },);
        setCustomWidth(false,);
        setCustomPadding(false,);
        setCustomMargin(false,);
        toast.info('Style reset to defaults',);
    };

    const handleCancelCustomWidth = () => {
        update('width', undefined,);
        setCustomWidth(false,);
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
            {/* Style properties */}
            <div class="block-style-editor__properties">
                {/* Background Color */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Background Color</label>
                    <div class="block-style-editor__color-row">
                        <ColorPicker
                            value={props.style.backgroundColor || ''}
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
                            value={props.style.textColor || BLOCK_STYLE_DEFAULTS.textColor}
                            onChange={(hex,) => update('textColor', hex,)}
                        />
                    </div>
                </div>

                {/* Background Image */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">
                        Background Image
                        <Tooltip
                            header="Background Image"
                            content="A full-bleed background for this block. It covers the block's whole box and is NOT clipped by the padding, so content still sits above it with the padding applied (the margin does inset it). When a background color is ALSO set, the image is the backdrop and the color/gradient renders as an overlay on top of it — use a translucent color or gradient to tint the image for readability."
                        />
                    </label>
                    <Show
                        when={props.style.backgroundImage}
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
                                src={props.style.backgroundImage}
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

                {/* Text Alignment */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Text Alignment</label>
                    <select
                        class="block-style-editor__select"
                        value={props.style.textAlign || BLOCK_STYLE_DEFAULTS.textAlign}
                        onChange={(e,) => update('textAlign', e.currentTarget.value,)}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="justify">Justify</option>
                    </select>
                </div>

                {/* Vertical Alignment */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Vertical Alignment</label>
                    <select
                        class="block-style-editor__select"
                        value={props.style.verticalAlign || BLOCK_STYLE_DEFAULTS.verticalAlign}
                        onChange={(e,) => update('verticalAlign', e.currentTarget.value,)}
                    >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                    </select>
                </div>

                {/* Font Size */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Font Size</label>
                    <select
                        class="block-style-editor__select"
                        value={props.style.fontSize || BLOCK_STYLE_DEFAULTS.fontSize}
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
                        value={props.style.fontFamily || ''}
                        onChange={(v,) => update('fontFamily', v,)}
                        noneLabel="Default (site font)"
                    />
                </div>

                {/* Width */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Width</label>
                    <div class="block-style-editor__field-right">
                        <Show
                            when={!customWidth()}
                            fallback={
                                <div class="block-style-editor__custom-input-row">
                                    <input
                                        type="text"
                                        class="block-style-editor__custom-input"
                                        value={props.style.width || ''}
                                        onChange={(e,) => update('width', e.currentTarget.value,)}
                                        placeholder="e.g. 50%, 300px"
                                    />
                                    <Tooltip
                                        content="Valid values: %, px, vw, rem, em, auto, max-content, min-content, or calc() expressions"
                                        header="CSS Width"
                                    />
                                    <button class="btn btn--small btn--ghost" onClick={handleCancelCustomWidth}>
                                        Cancel
                                    </button>
                                </div>
                            }
                        >
                            <div class="block-style-editor__preset-row">
                                <select
                                    class="block-style-editor__select"
                                    value={props.style.width || BLOCK_STYLE_DEFAULTS.width}
                                    onChange={(e,) => update('width', e.currentTarget.value,)}
                                >
                                    <option value="100%">Full</option>
                                    <option value="66.666%">2/3</option>
                                    <option value="50%">Half</option>
                                    <option value="33.333%">1/3</option>
                                    <option value="25%">1/4</option>
                                    <option value="20%">1/5</option>
                                </select>
                                <button class="btn btn--small btn--link" onClick={() => setCustomWidth(true,)}>
                                    Custom
                                </button>
                            </div>
                        </Show>
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
                                value={props.style.height || ''}
                                onChange={(e,) => update('height', e.currentTarget.value,)}
                                placeholder="e.g. 300px, 50vh"
                            />
                        </div>
                    </div>
                </div>

                {/* Padding */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Padding</label>
                    <div class="block-style-editor__field-right">
                        <Show
                            when={!customPadding()}
                            fallback={
                                <div class="block-style-editor__custom-input-row">
                                    <input
                                        type="text"
                                        class="block-style-editor__custom-input"
                                        value={props.style.padding || ''}
                                        onChange={(e,) => update('padding', e.currentTarget.value,)}
                                        placeholder="e.g. 10px 20px"
                                    />
                                    <Tooltip
                                        content="Valid values: px, vw, rem, em, %, or shorthand like '10px 20px 10px 20px'"
                                        header="CSS Padding"
                                    />
                                    <button class="btn btn--small btn--ghost" onClick={handleCancelCustomPadding}>
                                        Cancel
                                    </button>
                                </div>
                            }
                        >
                            <div class="block-style-editor__preset-row">
                                <select
                                    class="block-style-editor__select"
                                    value={props.style.padding || BLOCK_STYLE_DEFAULTS.padding}
                                    onChange={(e,) => update('padding', e.currentTarget.value,)}
                                >
                                    <option value={BLOCK_STYLE_DEFAULTS.padding}>
                                        Default ({BLOCK_STYLE_DEFAULTS.padding})
                                    </option>
                                    <For each={PADDING_OPTIONS}>
                                        {(val,) => <option value={val}>{val}</option>}
                                    </For>
                                </select>
                                <button class="btn btn--small btn--link" onClick={() => setCustomPadding(true,)}>
                                    Custom
                                </button>
                            </div>
                        </Show>
                        <span class="block-style-editor__help-text">Applied inside the content block</span>
                    </div>
                </div>

                {/* Margin */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Margin</label>
                    <div class="block-style-editor__field-right">
                        <Show
                            when={!customMargin()}
                            fallback={
                                <div class="block-style-editor__custom-input-row">
                                    <input
                                        type="text"
                                        class="block-style-editor__custom-input"
                                        value={props.style.margin || ''}
                                        onChange={(e,) => update('margin', e.currentTarget.value,)}
                                        placeholder="e.g. 10px 0"
                                    />
                                    <Tooltip
                                        content="Valid values: px, vw, rem, em, %, auto, or shorthand like '10px 20px 10px 20px'"
                                        header="CSS Margin"
                                    />
                                    <button class="btn btn--small btn--ghost" onClick={handleCancelCustomMargin}>
                                        Cancel
                                    </button>
                                </div>
                            }
                        >
                            <div class="block-style-editor__preset-row">
                                <select
                                    class="block-style-editor__select"
                                    value={props.style.margin || BLOCK_STYLE_DEFAULTS.margin}
                                    onChange={(e,) => update('margin', e.currentTarget.value,)}
                                >
                                    <option value={BLOCK_STYLE_DEFAULTS.margin}>
                                        Default ({BLOCK_STYLE_DEFAULTS.margin})
                                    </option>
                                    <For each={MARGIN_OPTIONS}>
                                        {(val,) => <option value={val}>{val}</option>}
                                    </For>
                                </select>
                                <button class="btn btn--small btn--link" onClick={() => setCustomMargin(true,)}>
                                    Custom
                                </button>
                            </div>
                        </Show>
                        <span class="block-style-editor__help-text">Applied outside the content block</span>
                    </div>
                </div>

                {/* Gap */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Gap</label>
                    <div class="block-style-editor__field-right">
                        <div class="block-style-editor__custom-input-row">
                            <input
                                type="text"
                                class="block-style-editor__custom-input"
                                value={props.style.gap || ''}
                                onChange={(e,) => update('gap', e.currentTarget.value,)}
                                placeholder="e.g. 1rem, 16px"
                            />
                            <Tooltip
                                content="Spacing between child items. Valid values: px, rem, em, vw. Applied when the block contains multiple items (e.g. campaign list)."
                                header="CSS Gap"
                            />
                        </div>
                        <span class="block-style-editor__help-text">Spacing between inner content items</span>
                    </div>
                </div>

                {/* Overflow X */}
                <div class="block-style-editor__field">
                    <label class="block-style-editor__label">Overflow X</label>
                    <select
                        class="block-style-editor__select"
                        value={props.style.overflowX || ''}
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
                        value={props.style.overflowY || ''}
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
