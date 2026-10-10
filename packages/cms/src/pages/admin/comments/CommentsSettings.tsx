/**
 * Comments → Settings: the Comments feature's switches (approval, reply
 * emails, the default for new items) and the discussion engine's settings
 * shared with the Forum (reactions, max length, edit window).
 */
import { A, } from '@solidjs/router';
import type { CommentsSettings, DiscussionsSettings, } from '@sitesurge/types';
import { DEFAULT_COMMENTS_SETTINGS, DEFAULT_DISCUSSIONS_SETTINGS, } from '@sitesurge/types';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import Toggle from '../../../components/admin/common/Toggle';
import { useToast, } from '../../../components/common/toast';
import EngineSettingsSection from '../../../components/discussions/admin/EngineSettingsSection';
import { cms, } from '../../../services/cmsClient';
import './CommentsAdmin.scss';

const CommentsSettingsPage: Component = () => {
    const toast = useToast();
    const [loaded, setLoaded,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [comments, setComments,] = createSignal<CommentsSettings>({ ...DEFAULT_COMMENTS_SETTINGS, },);
    const [engine, setEngine,] = createSignal<DiscussionsSettings>({ ...DEFAULT_DISCUSSIONS_SETTINGS, },);
    onMount(async () => {
        try {
            const [c, e,] = await Promise.all([cms.comments.settings(), cms.discussions.settings(),],);
            setComments(c,);
            setEngine(e,);
        } catch (err) {
            toast.error(`Could not load settings: ${(err as Error).message}`,);
        } finally {
            setLoaded(true,);
        }
    },);

    const patchComments = (p: Partial<CommentsSettings>,) => setComments({ ...comments(), ...p, },);
    const patchEngine = (p: Partial<DiscussionsSettings>,) => setEngine({ ...engine(), ...p, },);

    const save = async () => {
        setSaving(true,);
        try {
            const [c, e,] = await Promise.all([
                cms.comments.updateSettings(comments(),),
                cms.discussions.updateSettings({
                    reactionsEnabled: engine().reactionsEnabled,
                    reactions: engine().reactions,
                    maxLength: engine().maxLength,
                    editWindowMinutes: engine().editWindowMinutes,
                },),
            ],);
            setComments(c,);
            setEngine(e,);
            toast.success('Comment settings saved',);
        } catch (err) {
            toast.error(`Save failed: ${(err as Error).message}`,);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="comments-settings-page">
            <AdminTitle>Comment Settings</AdminTitle>
            <div class="admin-header">
                <A href="/admin/comments" class="admin-header__back">← Comments</A>
                <h1>Comment Settings</h1>
                <div class="admin-header__actions">
                    <button class="ui-button ui-button--primary" onClick={save} disabled={saving() || !loaded()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={loaded()} fallback={<div class="empty-state">Loading…</div>}>
                <section class="admin-section">
                    <header class="admin-section__header"><h2>Comments</h2></header>
                    <div class="form-section comments-settings-page__toggles">
                        <Toggle
                            checked={comments().enableByDefault}
                            onChange={(v,) => patchComments({ enableByDefault: v, },)}
                            label="Enable commenting on new posts and events"
                            hint="The starting value of “Enable commenting” on a new item. Existing items keep their own setting."
                        />
                        <Toggle
                            checked={comments().approveAnonymous}
                            onChange={(v,) => patchComments({ approveAnonymous: v, },)}
                            label="Approve anonymous comments before they show"
                            hint="Applies where an item allows anonymous comments. Recommended: anonymous comments attract spam."
                        />
                        <Toggle
                            checked={comments().approveAll}
                            onChange={(v,) => patchComments({ approveAll: v, },)}
                            label="Approve every new comment before it shows"
                            hint="Signed-in members too. Pending comments wait in the Comments queue."
                        />
                        <Toggle
                            checked={comments().notifyOnReply}
                            onChange={(v,) => patchComments({ notifyOnReply: v, },)}
                            label="Email members when someone replies to their comment"
                            hint="Uses the “Comment reply” email (Settings → Notifications sends staff alerts for new and reported comments)."
                        />
                    </div>
                </section>

                <EngineSettingsSection value={engine()} onChange={patchEngine} />
            </Show>
        </div>
    );
};

export default CommentsSettingsPage;
