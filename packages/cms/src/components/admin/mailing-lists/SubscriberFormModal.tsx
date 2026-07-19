/**
 * Add / edit a single subscriber on a mailing list. Used from the
 * subscribers table on the list edit page. Lives in its own file
 * (rather than co-located on the page) so future surfaces — bulk
 * import preview, public profile edit — can reuse it.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import type { MailingListSubscriber, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { FormField, } from '../forms';

interface SubscriberFormModalProps {
    listId: string;
    /** When set, the modal renders in edit mode. When omitted, it's an
     *  add form. */
    subscriber?: MailingListSubscriber;
    onClose: () => void;
    /** Called after a successful save / remove / force-confirm so the
     *  parent table can refetch. */
    onSaved: () => void;
}

const SubscriberFormModal: Component<SubscriberFormModalProps> = (p,) => {
    const isEditing = () => !!p.subscriber;
    const [email, setEmail,] = createSignal(p.subscriber?.email ?? '',);
    const [name, setName,] = createSignal(p.subscriber?.name ?? '',);
    const [phone, setPhone,] = createSignal(p.subscriber?.phone ?? '',);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const handleSave = async (): Promise<void> => {
        setSaving(true,);
        setError(null,);
        try {
            const data = { email: email(), name: name() || undefined, phone: phone() || undefined, };
            if (isEditing()) {
                await cms.mailingLists.updateSubscriber(p.listId, p.subscriber!.id, data as any,);
            } else {
                await cms.mailingLists.addSubscriber(p.listId, data as any,);
            }
            p.onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e,),);
        } finally { setSaving(false,); }
    };

    const handleRemove = async (): Promise<void> => {
        if (!confirm('Remove this subscriber?',)) return;
        await cms.mailingLists.removeSubscriber(p.listId, p.subscriber!.id,);
        p.onSaved();
    };

    const handleForceConfirm = async (): Promise<void> => {
        await cms.mailingLists.forceConfirmSubscriber(p.listId, p.subscriber!.id,);
        p.onSaved();
    };

    return (
        <Portal>
            <div class="confirm-modal-overlay" onClick={p.onClose}>
                <div class="subscriber-modal" onClick={(e,) => e.stopPropagation()}>
                    <h3>{isEditing() ? 'Edit Subscriber' : 'Add Subscriber'}</h3>
                    <Show when={error()}>
                        <div class="alert alert--error">{error()}</div>
                    </Show>
                    <FormField label="Email">
                        <input
                            type="email"
                            value={email()}
                            onInput={(e,) => setEmail(e.currentTarget.value,)}
                            disabled={isEditing()}
                        />
                    </FormField>
                    <FormField label="Name">
                        <input
                            type="text"
                            value={name()}
                            onInput={(e,) => setName(e.currentTarget.value,)}
                        />
                    </FormField>
                    <FormField label="Phone">
                        <input
                            type="tel"
                            value={phone()}
                            onInput={(e,) => setPhone(e.currentTarget.value,)}
                        />
                    </FormField>
                    <Show when={isEditing() && p.subscriber?.status === 'pending_confirmation'}>
                        <button type="button" class="btn btn--small btn--secondary" onClick={handleForceConfirm}>
                            Force Confirm
                        </button>
                    </Show>
                    <div class="modal-actions">
                        <Show when={isEditing()}>
                            <button type="button" class="btn btn--danger" onClick={handleRemove}>Remove</button>
                        </Show>
                        <button type="button" class="btn btn--secondary" onClick={p.onClose}>Cancel</button>
                        <button type="button" class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                            {saving() ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default SubscriberFormModal;
