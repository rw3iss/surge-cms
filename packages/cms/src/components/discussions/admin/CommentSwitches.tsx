/**
 * "Comments" switches for an item's admin editor (post, event): Enable
 * commenting · Allow anonymous comments · Lock comments, plus the count and a
 * link to the moderation queue for that item.
 *
 * `useCommentSwitches` holds the state; the editor calls `save(id)` after the
 * item itself is saved (a NEW item only has an id then). A new item starts
 * from Comments → Settings → "Enable commenting on new items".
 * Renders nothing unless the Comments feature is on.
 */
import { A, } from '@solidjs/router';
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import Toggle from '../../admin/common/Toggle';
import { FormField, } from '../../admin/forms';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import './CommentSwitches.scss';

export interface CommentSwitchesController {
    enabled: () => boolean;
    allowAnonymous: () => boolean;
    locked: () => boolean;
    commentCount: () => number;
    approveAnonymous: () => boolean;
    set: (patch: Partial<{ enabled: boolean; allowAnonymous: boolean; locked: boolean; }>,) => void;
    /** Persist for this item (no-op when the feature is off or nothing changed). */
    save: (id: string,) => Promise<void>;
    targetType: string;
    id: () => string | null;
}

export function useCommentSwitches(targetType: string, getId: () => string | null | undefined,): CommentSwitchesController {
    const [enabled, setEnabled,] = createSignal(false,);
    const [allowAnonymous, setAllowAnonymous,] = createSignal(false,);
    const [locked, setLocked,] = createSignal(false,);
    const [count, setCount,] = createSignal(0,);
    const [approveAnonymous, setApproveAnonymous,] = createSignal(true,);
    const [dirty, setDirty,] = createSignal(false,);

    createEffect(on(() => getId() ?? null, async (id,) => {
        if (!isFeatureEnabled('comments',)) return;
        setDirty(false,);
        try {
            const s = await cms.comments.settings();
            setApproveAnonymous(s.approveAnonymous,);
            if (!id) {
                // A new item: start from the site default, and save it with the item.
                setEnabled(s.enableByDefault,);
                setAllowAnonymous(false,);
                setLocked(false,);
                setCount(0,);
                setDirty(s.enableByDefault,);
                return;
            }
            const t = await cms.comments.thread(targetType, id,);
            setEnabled(t.enabled,);
            setAllowAnonymous(t.allowAnonymous,);
            setLocked(t.locked,);
            setCount(t.commentCount,);
        } catch { /* feature off or not permitted — leave the defaults */ }
    },),);

    return {
        enabled, allowAnonymous, locked, approveAnonymous, targetType,
        commentCount: count,
        id: () => getId() ?? null,
        set: (p,) => {
            if (p.enabled !== undefined) setEnabled(p.enabled,);
            if (p.allowAnonymous !== undefined) setAllowAnonymous(p.allowAnonymous,);
            if (p.locked !== undefined) setLocked(p.locked,);
            setDirty(true,);
        },
        save: async (id,) => {
            if (!isFeatureEnabled('comments',) || !dirty()) return;
            const t = await cms.comments.updateThread(targetType, id, {
                enabled: enabled(), allowAnonymous: allowAnonymous(), locked: locked(),
            },);
            setCount(t.commentCount,);
            setDirty(false,);
        },
    };
}

export interface CommentSwitchesFieldsProps {
    ctl: CommentSwitchesController;
    /** The editor's own dirty marker, so Save lights up. */
    onChange?: () => void;
}

export const CommentSwitchesFields: Component<CommentSwitchesFieldsProps> = (props,) => {
    const c = () => props.ctl;
    const change = (patch: Parameters<CommentSwitchesController['set']>[0],) => {
        c().set(patch,);
        props.onChange?.();
    };
    return (
        <Show when={isFeatureEnabled('comments',)}>
            <FormField
                label="Comments"
                tooltip="Readers can comment below this item. Moderate them in Comments (sidebar)."
            >
                <div class="comment-switches">
                    <Toggle
                        checked={c().enabled()}
                        onChange={(v,) => change({ enabled: v, },)}
                        label="Enable commenting"
                        hint="Signed-in members comment under their name."
                    />
                    <Show when={c().enabled()}>
                        <div class="comment-switches__sub">
                            <Toggle
                                checked={c().allowAnonymous()}
                                onChange={(v,) => change({ allowAnonymous: v, },)}
                                label="Allow anonymous comments"
                                hint={c().approveAnonymous()
                                    ? 'Visitors can comment without an account. Their comments wait for approval (Comments → Settings).'
                                    : 'Visitors can comment without an account. They show at once (Comments → Settings).'}
                            />
                            <Toggle
                                checked={c().locked()}
                                onChange={(v,) => change({ locked: v, },)}
                                label="Lock comments"
                                hint="Existing comments stay visible; no new ones."
                            />
                        </div>
                    </Show>
                    <Show when={c().id()}>
                        <div class="comment-switches__count">
                            {c().commentCount()} {c().commentCount() === 1 ? 'comment' : 'comments'}
                            <Show when={c().commentCount() > 0}>
                                {' · '}
                                <A href={`/admin/comments?target=${c().targetType}:${c().id()}&status=all`}>Moderate</A>
                            </Show>
                        </div>
                    </Show>
                </div>
            </FormField>
        </Show>
    );
};
