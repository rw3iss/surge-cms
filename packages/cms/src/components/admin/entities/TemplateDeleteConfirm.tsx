/**
 * Delete confirm for a block template or component — ONE body for the
 * template editor and the Components list.
 *
 * Lists where the template is used (each use links to its editor) and, when
 * it is used anywhere, asks for the template's name to be typed before Delete
 * is enabled: every one of those uses renders nothing afterwards. `usages`
 * null means the uses could not be checked, which the message says.
 */
import { A, } from '@solidjs/router';
import type { TemplateUsage, } from '@sitesurge/types';
import { createEffect, createSignal, For, Show, } from 'solid-js';
import ConfirmModal from '../common/ConfirmModal';
import { FormField, } from '../forms';
import { templateDeleteAllowed, usageHref, usageKind, } from './templateUsage';
import './TemplateDeleteConfirm.scss';

export interface TemplateDeleteConfirmProps {
    open: boolean;
    /** The template's name — what must be typed when it is in use. */
    name: string;
    usages: TemplateUsage[] | null;
    title: string;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function TemplateDeleteConfirm(props: TemplateDeleteConfirmProps,) {
    const [typed, setTyped,] = createSignal('',);
    createEffect(() => { if (props.open) setTyped('',); },);
    const inUse = () => (props.usages?.length ?? 0) > 0;
    const allowed = () => templateDeleteAllowed(props.usages, typed(), props.name,);

    return (
        <ConfirmModal
            open={props.open}
            title={props.title}
            confirmLabel="Delete"
            busyLabel="Deleting…"
            loading={props.loading}
            confirmDisabled={!allowed()}
            danger
            onConfirm={() => { if (allowed()) props.onConfirm(); }}
            onCancel={props.onCancel}
        >
            <Show
                when={inUse()}
                fallback={
                    <p class="confirm-modal__message">
                        {props.usages === null
                            ? 'This cannot be undone. Its uses could not be checked — anything that references it will render nothing.'
                            : 'It is not used anywhere. This cannot be undone.'}
                    </p>
                }
            >
                <p class="confirm-modal__message">
                    It is used in {props.usages!.length} place{props.usages!.length === 1 ? '' : 's'}. Every one of them
                    will render NOTHING where it was:
                </p>
                <ul class="template-delete__usages">
                    <For each={props.usages!}>
                        {(u,) => (
                            <li>
                                {usageKind(u.kind,)}:{' '}
                                <Show when={usageHref(u,)} fallback={u.title}>
                                    {(href,) => <A href={href()} target="_blank">{u.title}</A>}
                                </Show>
                                {u.blocks > 1 ? ` (${u.blocks} blocks)` : ''}
                            </li>
                        )}
                    </For>
                </ul>
                <FormField label={`Type "${props.name}" to confirm`}>
                    <input
                        type="text"
                        value={typed()}
                        // Search-as-you-type style: the confirm button reacts per keystroke.
                        onInput={(e,) => setTyped(e.currentTarget.value,)}
                    />
                </FormField>
            </Show>
        </ConfirmModal>
    );
}
