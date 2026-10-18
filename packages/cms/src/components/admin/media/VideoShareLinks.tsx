/**
 * Share links of one video (VideoStatusPanel): who created which link, when it
 * expires, and whether it still works — plus **Copy new share link** and
 * **Revoke share links**.
 *
 * Share tokens are stateless (an HMAC), so this list comes from the audit log
 * and the tokens themselves are never shown again. Revoking bumps the video's
 * share epoch: every link issued so far stops working at once; an access-level
 * change does the same. Needs `media.video:manage` — without it the section is
 * not shown.
 */
import type { MediaVideoSharesResponse, } from '@sitesurge/types';
import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import { FormField, } from '../forms';

const fmt = (iso: string | null,) => (iso ? new Date(iso,).toLocaleString() : '—');

const VideoShareLinks: Component<{ mediaId: string; }> = (props,) => {
    const toast = useToast();
    const [data, setData,] = createSignal<MediaVideoSharesResponse | null>(null,);
    const [hidden, setHidden,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [confirmRevoke, setConfirmRevoke,] = createSignal(false,);

    const load = async () => {
        try { setData(await cms.media.video.shares(props.mediaId,),); }
        catch { setHidden(true,); }
    };
    onMount(() => void load());

    const active = () => (data()?.links ?? []).filter((l,) => !l.revoked && !l.expired,).length;

    const createLink = async () => {
        setBusy(true,);
        try {
            const { url, } = await cms.media.video.share(props.mediaId, 7,);
            await navigator.clipboard.writeText(url,).then(
                () => toast.success('A 7-day share link was copied.',),
                () => window.prompt('Copy this share link:', url,),
            );
            await load();
        } catch (e) {
            toast.error(`Could not create a share link: ${(e as Error)?.message ?? ''}`,);
        } finally {
            setBusy(false,);
        }
    };

    const revoke = async () => {
        setBusy(true,);
        try {
            await cms.media.video.revokeShares(props.mediaId,);
            toast.success('Every share link of this video was revoked.',);
            setConfirmRevoke(false,);
            await load();
        } catch (e) {
            toast.error(`Could not revoke: ${(e as Error)?.message ?? ''}`,);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <Show when={!hidden() && data()}>
            {(d,) => (
                <FormField
                    label="Share links"
                    hint={`A share link plays the plain file for anyone until it expires. ${active()} working${d().lastRevokedAt ? ` · last revoked ${fmt(d().lastRevokedAt,)}` : ''}.`}
                >
                    <div class="video-share-links">
                        <div class="video-share-links__actions">
                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={busy()} onClick={() => void createLink()}>
                                Copy new share link
                            </button>
                            <button
                                type="button"
                                class="ui-button ui-button--danger ui-button--sm"
                                disabled={busy() || active() === 0}
                                onClick={() => setConfirmRevoke(true,)}
                            >
                                Revoke share links
                            </button>
                        </div>
                        <Show when={d().links.length} fallback={<p class="form-help-muted">No share links issued.</p>}>
                            <table class="video-status-panel__table video-share-links__table">
                                <thead><tr><th>Created</th><th>By</th><th>Expires</th><th>State</th></tr></thead>
                                <tbody>
                                    <For each={d().links}>
                                        {(l,) => (
                                            <tr>
                                                <td>{fmt(l.createdAt,)}</td>
                                                <td>{l.createdBy?.name ?? '—'}</td>
                                                <td>{fmt(l.expiresAt,)}</td>
                                                <td>{l.revoked ? 'Revoked' : l.expired ? 'Expired' : 'Working'}</td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </Show>
                    </div>
                    <ConfirmModal
                        open={confirmRevoke()}
                        title="Revoke every share link?"
                        message="Every share link issued for this video stops working now. New links can be created afterwards."
                        confirmLabel="Revoke links"
                        danger
                        loading={busy()}
                        onConfirm={() => void revoke()}
                        onCancel={() => setConfirmRevoke(false,)}
                    />
                </FormField>
            )}
        </Show>
    );
};

export default VideoShareLinks;
