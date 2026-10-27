/**
 * Reactions on one comment / forum post: a chip per kind in use (count, mine
 * highlighted) and a "☺+" picker with every allowed kind. Toggling goes
 * through `cms.discussions.react` and the chip pops.
 *
 * Signed out: chips are inert ("Log in to react") — or, when the caller passes
 * `onSignIn`, they stay clickable and open the caller's login prompt instead.
 * Shared by CommentItem (comments + forum pages) and the Forum block.
 */
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { errorText, } from './CommentComposer';
import './discussions.scss';

export interface ReactionBarProps {
    commentId: string;
    reactions: Record<string, number>;
    myReactions: string[];
    /** Allowed kinds, in display order (engine settings). */
    kinds: string[];
    /** Signed-out click → this (e.g. open a LoginModal). Without it the chips are inert. */
    onSignIn?: () => void;
    onError?: (message: string,) => void;
    /** After a toggle, with the new counts. */
    onChange?: (reactions: Record<string, number>, mine: string[],) => void;
    class?: string;
}

const ReactionBar: Component<ReactionBarProps> = (props,) => {
    const auth = useAuth();
    const [reactions, setReactions,] = createSignal<Record<string, number>>(props.reactions ?? {},);
    const [mine, setMine,] = createSignal<string[]>(props.myReactions ?? [],);
    const [picker, setPicker,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [popped, setPopped,] = createSignal<string | null>(null,);
    // A refreshed comment (poll / reload) brings fresh counts.
    // (Compared by value: a reconciled store keeps the same object while its counts change.)
    createEffect(on(() => JSON.stringify([props.reactions ?? {}, props.myReactions ?? [],],), () => {
        setReactions({ ...(props.reactions ?? {}), },);
        setMine([...(props.myReactions ?? []),],);
    }, { defer: true, },),);

    const signedIn = () => auth.isAuthenticated;
    const shown = () => props.kinds.filter((k,) => (reactions()[k] ?? 0) > 0);

    const react = async (kind: string,) => {
        if (!signedIn()) {
            props.onSignIn?.();
            return;
        }
        if (busy()) return;
        setBusy(true,);
        try {
            const r = await cms.discussions.react(props.commentId, kind,);
            setReactions(r.reactions,);
            setMine(r.myReactions,);
            setPicker(false,);
            setPopped(kind,);
            window.setTimeout(() => setPopped((p,) => (p === kind ? null : p)), 400,);
            props.onChange?.(r.reactions, r.myReactions,);
        } catch (e) {
            props.onError?.(errorText(e,),);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class={`comment-item__reactions${props.class ? ` ${props.class}` : ''}`}>
            <For each={shown()}>
                {(k,) => (
                    <button
                        type="button"
                        class="comment-item__reaction"
                        classList={{ 'is-mine': mine().includes(k,), 'is-pop': popped() === k, }}
                        disabled={!signedIn() && !props.onSignIn}
                        title={signedIn() ? undefined : 'Log in to react'}
                        aria-pressed={mine().includes(k,)}
                        onClick={() => void react(k,)}
                    >
                        <span>{k}</span> <span class="comment-item__reaction-n">{reactions()[k]}</span>
                    </button>
                )}
            </For>
            <Show when={signedIn() || props.onSignIn}>
                <span class="comment-item__picker-wrap">
                    <button
                        type="button"
                        class="comment-item__action comment-item__react-btn"
                        aria-expanded={picker()}
                        aria-label="Add a reaction"
                        title="React"
                        onClick={() => (signedIn() ? setPicker(!picker(),) : props.onSignIn?.())}
                    >
                        ☺+
                    </button>
                    <Show when={picker()}>
                        <span class="comment-item__picker" role="menu">
                            <For each={props.kinds}>
                                {(k,) => (
                                    <button type="button" role="menuitem" classList={{ 'is-mine': mine().includes(k,), }} onClick={() => void react(k,)}>{k}</button>
                                )}
                            </For>
                        </span>
                    </Show>
                </span>
            </Show>
        </div>
    );
};

export default ReactionBar;
