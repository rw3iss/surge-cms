/**
 * Pick SEVERAL files to upload LATER: drop them or browse, see local
 * previews, remove any, then hand the set back (`onStage`). Nothing is
 * uploaded here — a caller with a draft (the Gallery page) uploads on its
 * own Publish, through the same paths as MediaUploadModal.
 *
 * Each file gets a TITLE input, prefilled with the file name without its
 * extension (the server's default). Rows live in a store and are patched in
 * place, so editing a title never remounts the row (focus stays).
 */
import { isVideoFile, } from '@sitesurge/types';
import { createSignal, For, onCleanup, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import { defaultTitle, } from '../../../stores/uploads';
import ModalShell from '../common/ModalShell';
import { formatSize, } from './mediaUtils';
import './MediaStageModal.scss';

export interface MediaStageModalProps {
    /** `accept` for the file input, e.g. "image/*,video/*". */
    accept?: string;
    title?: string;
    /** Footer button text (default "Add files"). */
    confirmLabel?: string;
    onStage: (files: StagedFile[],) => void;
    onClose: () => void;
}

/** A picked file with the title the media item will get. */
export interface StagedFile { file: File; title: string; }

interface Staged { file: File; url: string; title: string; }

/** Does `file` match an `accept` list ("image/*,video/*,.pdf")? */
function accepts(file: File, accept?: string,): boolean {
    if (!accept) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return accept.split(',',).map((a,) => a.trim().toLowerCase()).filter(Boolean,).some((a,) => {
        if (a.startsWith('.',)) return name.endsWith(a,);
        if (a.endsWith('/*',)) {
            const major = a.slice(0, -2,);
            return type.startsWith(`${major}/`,) || (major === 'video' && isVideoFile(file.name, file.type,));
        }
        return type === a;
    },);
}

export default function MediaStageModal(props: MediaStageModalProps,) {
    const [state, setState,] = createStore<{ files: Staged[]; }>({ files: [], },);
    const files = () => state.files;
    const [rejected, setRejected,] = createSignal<string[]>([],);
    const [dragging, setDragging,] = createSignal(false,);
    let input: HTMLInputElement | undefined;
    let handedOff = false;

    // Object URLs are released unless they were handed to the caller.
    onCleanup(() => { if (!handedOff) files().forEach((f,) => URL.revokeObjectURL(f.url,),); },);

    const add = (list: FileList | File[] | null | undefined,) => {
        const incoming = Array.from(list ?? [],);
        const ok = incoming.filter((f,) => accepts(f, props.accept,),);
        setRejected(incoming.filter((f,) => !ok.includes(f,),).map((f,) => f.name,),);
        const seen = new Set(files().map((s,) => `${s.file.name}:${s.file.size}`,),);
        const fresh = ok.filter((f,) => !seen.has(`${f.name}:${f.size}`,),).map((file,) => ({
            file, url: URL.createObjectURL(file,), title: defaultTitle(file.name,),
        }));
        setState('files', (cur,) => [...cur, ...fresh,],);
    };

    const drop = (i: number,) => {
        const s = files()[i];
        if (s) URL.revokeObjectURL(s.url,);
        setState('files', (cur,) => cur.filter((_, j,) => j !== i,),);
    };

    const confirm = () => {
        handedOff = true;
        props.onStage(files().map((s,) => ({ file: s.file, title: s.title.trim() || defaultTitle(s.file.name,), })),);
    };

    return (
        <ModalShell open onClose={props.onClose} dismissOnBackdrop={false} dismissOnEscape={false} size="lg" class="media-stage-modal" ariaLabel={props.title ?? 'Add files'}>
            <div class="media-stage-modal__header">
                <h2>{props.title ?? 'Add files'}</h2>
                <button type="button" class="media-stage-modal__close" aria-label="Close" onClick={props.onClose}>&times;</button>
            </div>
            <div class="media-stage-modal__body">
                <div
                    class="media-stage-modal__drop"
                    classList={{ 'is-dragging': dragging(), }}
                    role="button"
                    tabindex="0"
                    onClick={() => input?.click()}
                    onKeyDown={(e,) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input?.click(); } }}
                    onDragOver={(e,) => { e.preventDefault(); setDragging(true,); }}
                    onDragLeave={() => setDragging(false,)}
                    onDrop={(e,) => { e.preventDefault(); setDragging(false,); add(e.dataTransfer?.files,); }}
                >
                    <strong>Drop files here</strong> or click to browse
                    <span class="media-stage-modal__hint">You can add several at once. They upload when you publish.</span>
                    <input
                        ref={input}
                        type="file"
                        multiple
                        accept={props.accept}
                        hidden
                        onChange={(e,) => { add(e.currentTarget.files,); e.currentTarget.value = ''; }}
                    />
                </div>
                <Show when={rejected().length}>
                    <div class="alert alert--warning">Not allowed here: {rejected().join(', ',)}</div>
                </Show>
                <Show when={files().length}>
                    <div class="media-stage-modal__grid">
                        <For each={files()}>
                            {(s, i,) => (
                                <div class="media-stage-modal__tile">
                                    <div class="media-stage-modal__preview">
                                        <Show
                                            when={isVideoFile(s.file.name, s.file.type,)}
                                            fallback={
                                                <Show when={s.file.type.startsWith('image/',)} fallback={<span class="media-stage-modal__icon">&#128196;</span>}>
                                                    <img src={s.url} alt="" />
                                                </Show>
                                            }
                                        >
                                            <video src={s.url} muted preload="metadata" />
                                            <span class="media-stage-modal__play" aria-hidden="true">&#9654;</span>
                                        </Show>
                                    </div>
                                    {/* Commits on blur / Enter (never per keystroke). */}
                                    <input
                                        type="text"
                                        class="media-stage-modal__title"
                                        value={s.title}
                                        maxLength={255}
                                        placeholder={defaultTitle(s.file.name,) || 'Title'}
                                        aria-label={`Title for ${s.file.name}`}
                                        title={s.file.name}
                                        onChange={(e,) => setState('files', i(), 'title', e.currentTarget.value,)}
                                        onKeyDown={(e,) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                    />
                                    <div class="media-stage-modal__meta">{formatSize(s.file.size,)}</div>
                                    <button type="button" class="media-stage-modal__remove" aria-label={`Remove ${s.file.name}`} onClick={() => drop(i(),)}>&times;</button>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
            <div class="media-stage-modal__footer">
                <span class="media-stage-modal__count">{files().length ? `${files().length} file${files().length > 1 ? 's' : ''}` : 'No files yet'}</span>
                <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onClose}>Cancel</button>
                <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={!files().length} onClick={confirm}>
                    {props.confirmLabel ?? 'Add files'}
                </button>
            </div>
        </ModalShell>
    );
}
