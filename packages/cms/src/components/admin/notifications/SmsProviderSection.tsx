/**
 * Settings → Notifications → SMS provider (Twilio first; AWS SNS later). Its
 * own Save. The auth token is shown as the server's mask; sending the mask
 * back keeps the stored token. `onSaved` reports whether SMS is now usable.
 */
import { createSignal, onMount, Show, type Component, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { SmsSettings, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import { CommitInput, FormField, } from '../forms';
import './notifications.scss';

const SmsProviderSection: Component<{ onSaved?: (configured: boolean,) => void; }> = (props,) => {
    const toast = useToast();
    const [s, setS,] = createStore<SmsSettings>({ provider: 'none', accountSid: '', authToken: '', fromNumber: '', configured: false, },);
    const [saving, setSaving,] = createSignal(false,);
    const [testTo, setTestTo,] = createSignal('',);
    const [testing, setTesting,] = createSignal(false,);
    let tokenEl: HTMLInputElement | undefined;

    onMount(async () => {
        try {
            const v = await cms.notifications.sms();
            setS(v,);
            props.onSaved?.(!!v.configured,);
        } catch { /* not allowed / not loaded — the section stays empty */ }
    },);

    const save = async () => {
        setSaving(true,);
        try {
            const v = await cms.notifications.setSms({
                provider: s.provider, accountSid: s.accountSid, fromNumber: s.fromNumber,
                authToken: tokenEl?.value ?? s.authToken,
            },);
            setS(v,);
            props.onSaved?.(!!v.configured,);
            toast.success(v.configured ? 'SMS provider saved — texts can be sent.' : 'SMS settings saved.',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not save the SMS settings.',);
        } finally {
            setSaving(false,);
        }
    };

    const test = async () => {
        setTesting(true,);
        try {
            await cms.notifications.testSms(testTo().trim(),);
            toast.success('Test SMS sent.',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The test SMS failed.',);
        } finally {
            setTesting(false,);
        }
    };

    return (
        <section class="admin-section notifications-sms">
            <header class="admin-section__header">
                <h2>SMS provider</h2>
                <p class="form-help-muted">Send notifications as text messages. Twilio for now (AWS SNS later). Status: <strong>{s.configured ? 'ready' : 'not set up'}</strong>.</p>
            </header>
            <div class="admin-form-row">
                <FormField label="Provider">
                    <select value={s.provider} onChange={(e,) => setS('provider', e.currentTarget.value as SmsSettings['provider'],)}>
                        <option value="none" selected={s.provider === 'none'}>None (SMS off)</option>
                        <option value="twilio" selected={s.provider === 'twilio'}>Twilio</option>
                    </select>
                </FormField>
            </div>
            <Show when={s.provider === 'twilio'}>
                <div class="admin-form-row">
                    <FormField label="Account SID" hint="From the Twilio Console (starts with AC).">
                        <CommitInput value={s.accountSid} placeholder="AC…" onCommit={(v,) => setS('accountSid', v,)} />
                    </FormField>
                    <FormField label="Auth token" hint="Kept secret; leave as is to keep the saved one.">
                        <input ref={tokenEl} type="password" autocomplete="new-password" value={s.authToken} placeholder="Auth token" />
                    </FormField>
                    <FormField label="From" hint="Your Twilio number (+12155550123) or a Messaging Service SID (MG…).">
                        <CommitInput value={s.fromNumber} placeholder="+12155550123" onCommit={(v,) => setS('fromNumber', v,)} />
                    </FormField>
                </div>
            </Show>
            <div class="notifications-sms__actions">
                <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={saving()} onClick={() => void save()}>
                    {saving() ? 'Saving…' : 'Save SMS provider'}
                </button>
                <Show when={s.configured}>
                    <span class="notifications-sms__test">
                        <CommitInput value={testTo()} placeholder="+12155550123" aria-label="Test number" onCommit={setTestTo} onDraft={setTestTo} />
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={testing() || !testTo().trim()} onClick={() => void test()}>
                            {testing() ? 'Sending…' : 'Send test SMS'}
                        </button>
                    </span>
                </Show>
            </div>
        </section>
    );
};

export default SmsProviderSection;
