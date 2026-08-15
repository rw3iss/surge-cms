import { Component, createEffect, createMemo, createSignal, For, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import { Portal, } from 'solid-js/web';
import type { ContactFieldsInput, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './ContactMatchModal.scss';

/** Editable fields shown in the modal, in display order. */
const FIELDS: { key: keyof ContactFieldsInput; label: string; }[] = [
    { key: 'firstName', label: 'First name', },
    { key: 'lastName', label: 'Last name', },
    { key: 'mobilePhone', label: 'Mobile phone', },
    { key: 'primaryPhone', label: 'Primary phone', },
    { key: 'streetAddress1', label: 'Street address 1', },
    { key: 'streetAddress2', label: 'Street address 2', },
    { key: 'city', label: 'City', },
    { key: 'state', label: 'State / region', },
    { key: 'zip', label: 'Zip code', },
    { key: 'country', label: 'Country', },
    { key: 'timeZone', label: 'Time zone', },
];

/**
 * Shown once to a signed-in member when an UNLINKED CRM contact matches their
 * email (imported from the old system). Explains we have their info, shows each
 * piece as an editable field, and lets them import it into their profile — or
 * cancel. Either way the backend links the contact to their account (so it's
 * never offered again); "Use this info" additionally copies name/city/state
 * onto their profile.
 *
 * Mounted once in the public Layout; controls its own visibility from the auth
 * store (`contactPrompt`).
 */
export const ContactMatchModal: Component = () => {
    const auth = useAuth();
    const [fields, setFields,] = createStore<ContactFieldsInput>({},);
    const [seededId, setSeededId,] = createSignal<string | null>(null,);
    const [busy, setBusy,] = createSignal<false | 'import' | 'cancel'>(false,);
    const [error, setError,] = createSignal('',);

    // Seed the editable fields from the matched contact the first time it appears
    // (and whenever a different contact is offered).
    const contact = () => auth.contactPrompt;
    createEffect(() => {
        const c = contact();
        if (!c || seededId() === c.id) return;
        setSeededId(c.id,);
        setFields({
            firstName: c.firstName ?? '', lastName: c.lastName ?? '',
            mobilePhone: c.mobilePhone ?? '', primaryPhone: c.primaryPhone ?? '',
            streetAddress1: c.streetAddress1 ?? '', streetAddress2: c.streetAddress2 ?? '',
            city: c.city ?? '', state: c.state ?? '', zip: c.zip ?? '',
            country: c.country ?? '', timeZone: c.timeZone ?? '',
        },);
    },);

    // Only offer fields we actually have data for (plus name, always).
    const shownFields = createMemo(() => {
        const c = contact();
        if (!c) return [] as typeof FIELDS;
        return FIELDS.filter((f,) =>
            f.key === 'firstName' || f.key === 'lastName'
            || (c[f.key as keyof typeof c] != null && String(c[f.key as keyof typeof c],).trim() !== '')
        );
    },);

    const trimmed = (): ContactFieldsInput => {
        const out: ContactFieldsInput = {};
        for (const f of FIELDS) {
            const v = fields[f.key];
            out[f.key] = v != null && String(v,).trim() !== '' ? String(v,).trim() : null;
        }
        return out;
    };

    const confirmImport = async () => {
        const c = contact();
        if (!c || busy()) return;
        setBusy('import',);
        setError('',);
        try {
            await cms.contacts.link({ contactId: c.id, fields: trimmed(), importProfile: true, },);
            await auth.refreshUser();
            auth.dismissContactPrompt();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not import your info.',);
            setBusy(false,);
        }
    };

    // Cancel / close: still link the contact (per design) but don't import to the
    // profile. Best-effort — closing the modal always wins.
    const cancel = async () => {
        const c = contact();
        if (busy()) return;
        setBusy('cancel',);
        try {
            if (c) await cms.contacts.link({ contactId: c.id, importProfile: false, },);
        } catch { /* best-effort link */ }
        auth.dismissContactPrompt();
        setBusy(false,);
    };

    return (
        <Show when={contact()}>
            <Portal>
                <div class="contact-match-overlay" role="dialog" aria-modal="true" aria-labelledby="contact-match-title">
                    <div class="contact-match-modal">
                        <button
                            type="button"
                            class="contact-match-modal__close"
                            aria-label="Close"
                            onClick={cancel}
                            disabled={busy() !== false}
                        >
                            ×
                        </button>
                        <h2 id="contact-match-title" class="contact-match-modal__title">
                            We found your info
                        </h2>
                        <p class="contact-match-modal__body">
                            We have contact details for <strong>{contact()?.email}</strong> from our previous system.
                            Review or edit anything below, then import it to your profile — or close this to skip
                            (we'll simply link it to your account).
                        </p>

                        <form
                            class="contact-match-modal__form"
                            onSubmit={(e,) => { e.preventDefault(); void confirmImport(); }}
                        >
                            <For each={shownFields()}>
                                {(f,) => (
                                    <label class="contact-match-modal__field">
                                        <span class="contact-match-modal__label">{f.label}</span>
                                        <input
                                            class="contact-match-modal__input"
                                            type="text"
                                            maxLength={255}
                                            value={(fields[f.key] as string) ?? ''}
                                            onInput={(ev,) => setFields(f.key, ev.currentTarget.value,)}
                                        />
                                    </label>
                                )}
                            </For>

                            <Show when={error()}>
                                <div class="contact-match-modal__error">{error()}</div>
                            </Show>

                            <div class="contact-match-modal__actions">
                                <button
                                    type="button"
                                    class="contact-match-modal__btn contact-match-modal__btn--ghost"
                                    onClick={cancel}
                                    disabled={busy() !== false}
                                >
                                    {busy() === 'cancel' ? 'Closing…' : 'Not now'}
                                </button>
                                <button
                                    type="submit"
                                    class="contact-match-modal__btn contact-match-modal__btn--primary"
                                    disabled={busy() !== false}
                                >
                                    {busy() === 'import' ? 'Importing…' : 'Use this info'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </Portal>
        </Show>
    );
};

export default ContactMatchModal;
