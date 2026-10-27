/**
 * Settings → Notifications: one notification TYPE and its channels — email,
 * SMS, in-app (users + roles) and desktop push (to the in-app recipients).
 * Controlled: the panel owns the state (a store) and saves it.
 */
import { createSignal, Show, type Component, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import Toggle from '../common/Toggle';
import { CommitInput, FormField, } from '../forms';
import UserRolePicker from './UserRolePicker';
import './notifications.scss';

/** Editable state for one type (address lists kept as the typed text). */
export interface NotificationTypeDraft {
    email: { enabled: boolean; addresses: string; };
    sms: { enabled: boolean; addresses: string; };
    inApp: { enabled: boolean; userIds: string[]; roles: string[]; };
    push: { enabled: boolean; };
}

export const splitList = (raw: string,): string[] => raw.split(/[,;\n]/,).map((a,) => a.trim()).filter(Boolean,);

const E164 = /^\+[1-9]\d{6,14}$/;
/** A message naming the bad numbers, or null. */
export const phoneListError = (raw: string,): string | null => {
    const bad = splitList(raw,).filter((n,) => !E164.test(n,),);
    return bad.length ? `Not an international number (+ country code, digits only): ${bad.join(', ',)}` : null;
};

interface Props {
    label: string;
    description?: string;
    typeKey: string;
    draft: NotificationTypeDraft;
    onPatch: <K extends keyof NotificationTypeDraft>(channel: K, patch: Partial<NotificationTypeDraft[K]>,) => void;
    smsConfigured: boolean;
    inAppEnabled: boolean;
}

const NotificationTypeCard: Component<Props> = (props,) => {
    const toast = useToast();
    const [testing, setTesting,] = createSignal(false,);

    const sendTest = async () => {
        setTesting(true,);
        try {
            await cms.notifications.test(props.typeKey,);
            toast.success(`Test "${props.label}" notification sent to the saved recipients.`,);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The test notification failed.',);
        } finally {
            setTesting(false,);
        }
    };

    return (
        <section class="admin-section notification-type">
            <header class="admin-section__header notification-type__header">
                <div>
                    <h2>{props.label}</h2>
                    <Show when={props.description}><p class="form-help-muted">{props.description}</p></Show>
                </div>
                <button
                    type="button"
                    class="ui-button ui-button--secondary ui-button--sm"
                    disabled={testing()}
                    title="Sends a sample to the SAVED recipients — save first."
                    onClick={() => void sendTest()}
                >
                    {testing() ? 'Sending…' : 'Send test'}
                </button>
            </header>

            {/* Email */}
            <Toggle label="Email" checked={props.draft.email.enabled} onChange={(v,) => props.onPatch('email', { enabled: v, },)} />
            <Show when={props.draft.email.enabled}>
                <FormField label="Recipient emails" hint="Comma-separated email addresses.">
                    <CommitInput
                        value={props.draft.email.addresses}
                        placeholder="alerts@example.com, ops@example.com"
                        onCommit={(v,) => props.onPatch('email', { addresses: v, },)}
                    />
                </FormField>
            </Show>

            {/* SMS */}
            <Show
                when={props.smsConfigured}
                fallback={<p class="form-help-muted notification-type__muted">SMS: set up an SMS provider above to send texts.</p>}
            >
                <Toggle label="SMS" checked={props.draft.sms.enabled} onChange={(v,) => props.onPatch('sms', { enabled: v, },)} />
                <Show when={props.draft.sms.enabled}>
                    <FormField label="Phone numbers" hint="Comma-separated, international format (+12155550123).">
                        <CommitInput
                            value={props.draft.sms.addresses}
                            placeholder="+12155550123, +447700900123"
                            validate={phoneListError}
                            onCommit={(v,) => props.onPatch('sms', { addresses: v, },)}
                        />
                    </FormField>
                </Show>
            </Show>

            {/* In-app + desktop */}
            <Show
                when={props.inAppEnabled}
                fallback={<p class="form-help-muted notification-type__muted">In-app: turn on "Show notifications in the admin" above to send in-app notifications.</p>}
            >
                <Toggle label="In-app" checked={props.draft.inApp.enabled} onChange={(v,) => props.onPatch('inApp', { enabled: v, },)} />
                <Show when={props.draft.inApp.enabled}>
                    <FormField
                        label="Recipients"
                        hint="Chosen users and everyone with a chosen role (main or additional) — they need admin access to see them."
                    >
                        <UserRolePicker
                            userIds={props.draft.inApp.userIds}
                            roles={props.draft.inApp.roles}
                            onChange={(v,) => props.onPatch('inApp', v,)}
                        />
                    </FormField>
                    <Toggle
                        label="Also send as a desktop notification"
                        hint="Goes to the in-app recipients on browsers where they turned desktop notifications on."
                        checked={props.draft.push.enabled}
                        onChange={(v,) => props.onPatch('push', { enabled: v, },)}
                    />
                </Show>
            </Show>
        </section>
    );
};

export default NotificationTypeCard;
