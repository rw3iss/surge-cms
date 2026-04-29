/**
 * Font manager panel — uploaded font assets for the site.
 *
 * Lives inside Settings → Appearance as its own section. The panel:
 *   - Lists every font row from the server (custom_id, family name,
 *     filename, size).
 *   - Renders a live sample using a dynamic @font-face declaration
 *     so the operator can see what each font looks like before
 *     referencing it elsewhere.
 *   - Allows upload via a normal file input; the operator can supply
 *     a custom id (`brand-headline`) or let the server auto-pick
 *     `font{N}`.
 *   - Allows delete with a confirm modal.
 *
 * Sample text (and the sample font size) sit at the panel level so
 * all fonts render with the same baseline for visual comparison.
 */
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import {
    deleteFont,
    type Font,
    fonts as fontsSignal,
    loadFonts,
    uploadFont,
} from '../../services/fonts';
import ConfirmModal from './ConfirmModal';
import './FontManagerPanel.scss';

const SAMPLE_TEXT_DEFAULT = 'The quick brown fox jumps over the lazy dog 0123456789';

/**
 * Inject (or reuse) a single <style> tag carrying @font-face
 * declarations for every font in the list. We rebuild the contents
 * on every list change — the cost is trivial (a few hundred bytes
 * of text) and the alternative (managing per-font tags) carries
 * more bookkeeping than it saves.
 *
 * The declared family name matches the font's `customId` so the
 * sample renderer (and any other admin surface) can use
 * `font-family: 'fontN'` directly.
 */
function applyFontFaces(list: Font[],): void {
    const tagId = 'font-manager-faces';
    let tag = document.getElementById(tagId,) as HTMLStyleElement | null;
    if (!tag) {
        tag = document.createElement('style',);
        tag.id = tagId;
        document.head.appendChild(tag,);
    }
    const formatHint = (fmt: string,) => {
        switch (fmt) {
            case 'woff2': return 'woff2';
            case 'woff': return 'woff';
            case 'ttf': return 'truetype';
            case 'otf': return 'opentype';
            case 'eot': return 'embedded-opentype';
            default: return fmt;
        }
    };
    tag.textContent = list.map(f =>
        `@font-face { font-family: '${f.customId}'; src: url('${f.url}') format('${formatHint(f.format,)}'); font-display: swap; }`
    ,).join('\n',);
}

const FontManagerPanel: Component = () => {
    const [uploading, setUploading,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [success, setSuccess,] = createSignal('',);
    const [customIdInput, setCustomIdInput,] = createSignal('',);
    const [familyNameInput, setFamilyNameInput,] = createSignal('',);
    const [pendingFile, setPendingFile,] = createSignal<File | null>(null,);
    const [sampleText, setSampleText,] = createSignal(SAMPLE_TEXT_DEFAULT,);
    const [sampleSize, setSampleSize,] = createSignal(28,);
    const [deleteTarget, setDeleteTarget,] = createSignal<Font | null>(null,);

    let fileInputRef: HTMLInputElement | undefined;

    onMount(async () => {
        const list = await loadFonts();
        applyFontFaces(list,);
    },);

    // Re-apply @font-face every time the list changes (after upload
    // or delete). createSignal subscribers fire synchronously on
    // setFonts, so this runs before the next render.
    const updateFaces = () => applyFontFaces(fontsSignal(),);

    const onFileChange = (e: Event,) => {
        const input = e.currentTarget as HTMLInputElement;
        setPendingFile(input.files?.[0] || null,);
        setError('',);
        setSuccess('',);
    };

    const onUpload = async () => {
        const file = pendingFile();
        if (!file) {
            setError('Pick a font file first.',);
            return;
        }
        setUploading(true,);
        setError('',);
        setSuccess('',);
        try {
            await uploadFont(file, {
                customId: customIdInput().trim() || undefined,
                familyName: familyNameInput().trim() || undefined,
            },);
            updateFaces();
            setSuccess(`Uploaded ${file.name}.`,);
            setPendingFile(null,);
            setCustomIdInput('',);
            setFamilyNameInput('',);
            if (fileInputRef) fileInputRef.value = '';
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed',);
        } finally {
            setUploading(false,);
        }
    };

    const onConfirmDelete = async () => {
        const target = deleteTarget();
        if (!target) return;
        try {
            await deleteFont(target.id,);
            updateFaces();
            setSuccess(`Removed ${target.customId}.`,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Delete failed',);
        } finally {
            setDeleteTarget(null,);
        }
    };

    return (
        <div class="theme-section font-manager">
            <h4 class="theme-section__title">Font manager</h4>
            <p class="theme-section__description">
                Upload custom fonts (WOFF2, WOFF, TTF, OTF) and reference them by their ID elsewhere
                in the site (block styles, header / footer items, etc.). Auto-IDs (<code>font1</code>,{' '}
                <code>font2</code>) are assigned when you don't supply one.
            </p>

            {/* ─── Upload row ──────────────────────────────── */}
            <div class="font-manager__upload">
                <div class="font-manager__upload-row">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".woff2,.woff,.ttf,.otf,.eot,font/woff2,font/woff,font/ttf,font/otf"
                        onChange={onFileChange}
                    />
                    <input
                        type="text"
                        class="font-manager__id-input"
                        value={customIdInput()}
                        onInput={(e,) => setCustomIdInput(e.currentTarget.value,)}
                        placeholder="Custom ID (optional)"
                        maxLength={64}
                    />
                    <input
                        type="text"
                        class="font-manager__family-input"
                        value={familyNameInput()}
                        onInput={(e,) => setFamilyNameInput(e.currentTarget.value,)}
                        placeholder="Display name (optional)"
                        maxLength={255}
                    />
                    <button
                        class="btn btn--primary btn--small"
                        type="button"
                        disabled={!pendingFile() || uploading()}
                        onClick={onUpload}
                    >
                        {uploading() ? 'Uploading…' : 'Upload'}
                    </button>
                </div>
                <Show when={error()}>
                    <div class="alert alert--error font-manager__alert">{error()}</div>
                </Show>
                <Show when={success() && !error()}>
                    <div class="alert alert--success font-manager__alert">{success()}</div>
                </Show>
            </div>

            {/* ─── Sample controls ─────────────────────────── */}
            <div class="font-manager__sample-controls">
                <label>
                    <span>Sample text</span>
                    <input
                        type="text"
                        value={sampleText()}
                        onInput={(e,) => setSampleText(e.currentTarget.value,)}
                    />
                </label>
                <label>
                    <span>Sample size</span>
                    <input
                        type="range"
                        min="12"
                        max="72"
                        value={sampleSize()}
                        onInput={(e,) => setSampleSize(Number(e.currentTarget.value,),)}
                    />
                    <span class="font-manager__sample-size-readout">{sampleSize()}px</span>
                </label>
            </div>

            {/* ─── Font list ───────────────────────────────── */}
            <div class="font-manager__list">
                <Show when={fontsSignal().length === 0}>
                    <p class="font-manager__empty">No fonts uploaded yet.</p>
                </Show>
                <For each={fontsSignal()}>
                    {(font,) => (
                        <div class="font-manager__row">
                            <div class="font-manager__row-meta">
                                <span class="font-manager__row-id">{font.customId}</span>
                                <span class="font-manager__row-family">
                                    {font.familyName || font.originalName}
                                </span>
                                <span class="font-manager__row-detail">
                                    {font.format.toUpperCase()} · {Math.round(font.sizeBytes / 1024,)} KB
                                </span>
                            </div>
                            <div
                                class="font-manager__row-sample"
                                style={{
                                    'font-family': `'${font.customId}', system-ui, sans-serif`,
                                    'font-size': `${sampleSize()}px`,
                                }}
                            >
                                {sampleText()}
                            </div>
                            <button
                                class="font-manager__row-delete"
                                type="button"
                                onClick={() => setDeleteTarget(font,)}
                                title="Remove font"
                                aria-label={`Remove ${font.customId}`}
                            >
                                ×
                            </button>
                        </div>
                    )}
                </For>
            </div>

            <ConfirmModal
                open={!!deleteTarget()}
                title="Remove font"
                message={
                    deleteTarget()
                        ? `Remove '${deleteTarget()!.customId}'? Any element using this font will fall back to the next family in its stack.`
                        : ''
                }
                confirmLabel="Remove"
                onConfirm={onConfirmDelete}
                onCancel={() => setDeleteTarget(null,)}
                danger={true}
            />
        </div>
    );
};

export default FontManagerPanel;
