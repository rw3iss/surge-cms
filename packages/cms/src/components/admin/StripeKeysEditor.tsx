/**
 * Reusable Stripe key editor for one payment context (default | shop | donations).
 * Shows the live connection status, an optional "use site default keys" toggle
 * (for sub-contexts), and the three key inputs (publishable is public + shown in
 * full; secret + webhook are write-only). Backed by the context-aware
 * /settings/payment-credentials + /settings/stripe-status endpoints.
 */
import { Component, createEffect, createResource, createSignal, Show, } from 'solid-js';
import type { PaymentContext, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../common/toast';
import { FormField, } from './forms';
import Toggle from './common/Toggle';

interface Props {
    context: PaymentContext;
    /** Show the "use site default keys" toggle (sub-contexts only). */
    showUseDefault?: boolean;
    title?: string;
    description?: string;
}

const StripeKeysEditor: Component<Props> = (props,) => {
    const toast = useToast();

    const [status, { mutate: setStatus, },] = createResource(() => cms.settings.stripeStatus(props.context,));
    const [creds, { mutate: setCreds, },] = createResource(() => cms.settings.paymentCredentials(props.context,));

    const [pubKey, setPubKey,] = createSignal('',);
    const [secret, setSecret,] = createSignal('',);
    const [webhook, setWebhook,] = createSignal('',);
    const [useDefault, setUseDefault,] = createSignal(true,);
    const [saving, setSaving,] = createSignal(false,);
    const [rechecking, setRechecking,] = createSignal(false,);

    // Prefill from the masked status once it loads.
    createEffect(() => {
        const c = creds();
        if (c) {
            setPubKey(c.publishableKey || '',);
            setUseDefault(c.useDefault,);
        }
    },);

    const recheck = async () => {
        setRechecking(true,);
        try {
            setStatus(await cms.settings.stripeStatus(props.context, true,).catch(() => undefined,),);
        } finally {
            setRechecking(false,);
        }
    };

    const save = async () => {
        setSaving(true,);
        try {
            const body: {
                context: PaymentContext;
                useDefault?: boolean;
                publishableKey?: string;
                secretKey?: string;
                webhookSecret?: string;
            } = { context: props.context, };
            if (props.showUseDefault) body.useDefault = useDefault();
            // Only send keys when this context uses its own (or it's the default
            // context, which has no toggle).
            if (!props.showUseDefault || !useDefault()) {
                body.publishableKey = pubKey().trim(); // blank clears
                if (secret().trim()) body.secretKey = secret().trim();
                if (webhook().trim()) body.webhookSecret = webhook().trim();
            }
            const updated = await cms.settings.updatePaymentCredentials(body,);
            setCreds(updated,);
            setSecret('',);
            setWebhook('',);
            toast.success('Stripe keys saved.',);
            await recheck();
        } catch (err: any) {
            toast.error(err?.message || 'Failed to save Stripe keys.',);
        } finally {
            setSaving(false,);
        }
    };

    // Whether to show the key inputs: always for the default context, else only
    // when the operator has chosen to override with custom keys.
    const showInputs = () => !props.showUseDefault || !useDefault();

    return (
        <div class="shop-stripe-keys">
            <Show when={props.title}>
                <h3 class="shop-stripe-keys__title">{props.title}</h3>
            </Show>
            <Show when={props.description}>
                <p class="form-help-muted">{props.description}</p>
            </Show>

            {/* Connection status banner. */}
            <Show when={status.state !== 'pending' ? status() : null} fallback={<p class="form-help-muted">Checking Stripe connection…</p>} keyed>
                {(s,) => {
                    const accepting = s.connected && (s.mode === 'test' || s.chargesEnabled);
                    const level = accepting ? 'ok' : s.connected ? 'warn' : 'error';
                    return (
                        <div class="shop-stripe">
                            <div class={`shop-stripe__banner shop-stripe__banner--${level}`}>
                                <span class="shop-stripe__dot" />
                                <div class="shop-stripe__headline">
                                    <strong>
                                        {accepting
                                            ? 'Connected — accepting payments'
                                            : s.connected
                                                ? 'Connected — not yet accepting live charges'
                                                : s.configured
                                                    ? 'Not connected'
                                                    : 'Stripe not configured'}
                                    </strong>
                                    <Show when={s.mode}>
                                        <span class={`badge ${s.mode === 'live' ? 'badge--success' : 'badge--info'}`}>
                                            {s.mode === 'live' ? 'Live mode' : 'Test mode'}
                                        </span>
                                    </Show>
                                </div>
                            </div>
                            <Show when={s.connected}>
                                <dl class="shop-stripe__details">
                                    <div><dt>Account</dt><dd>{s.displayName || s.accountId}</dd></div>
                                    <div><dt>Charges enabled</dt><dd>{s.chargesEnabled ? 'Yes' : 'No'}</dd></div>
                                    <div><dt>Webhook secret</dt><dd>{s.webhookConfigured ? 'Configured' : 'Missing'}</dd></div>
                                    <div><dt>Publishable key</dt><dd>{s.publishableKeyConfigured ? 'Configured' : 'Missing'}</dd></div>
                                </dl>
                            </Show>
                            <div class="shop-stripe__footer">
                                <button class="btn btn--small btn--secondary" onClick={recheck} disabled={rechecking()}>
                                    {rechecking() ? 'Checking…' : 'Recheck'}
                                </button>
                            </div>
                        </div>
                    );
                }}
            </Show>

            {/* Sub-context: inherit vs override. */}
            <Show when={props.showUseDefault}>
                <div class="form-group">
                    <Toggle
                        label="Use site default payment settings"
                        checked={useDefault()}
                        onChange={setUseDefault}
                    />
                    <span class="form-help">
                        {useDefault()
                            ? 'This section uses the site-wide Stripe keys from Settings → Payments.'
                            : 'This section uses its own Stripe account below (blank fields fall back to the site default).'}
                    </span>
                </div>
            </Show>

            <Show when={showInputs()}>
                <FormField label="Publishable key" hint="Starts with pk_. Public — loaded by the checkout / donation forms.">
                    <input type="text" autocomplete="off" spellcheck={false} placeholder="pk_live_… or pk_test_…" value={pubKey()} onInput={(e,) => setPubKey(e.currentTarget.value,)} />
                </FormField>
                <FormField
                    label="Secret key"
                    hint={creds()?.secretKeyConfigured ? `Currently set (…${creds()!.secretKeyLast4}). Leave blank to keep it.` : 'Starts with sk_. Server-only — used to create charges.'}
                >
                    <input type="password" autocomplete="off" spellcheck={false} placeholder={creds()?.secretKeyConfigured ? '•••••••••• (unchanged)' : 'sk_live_… or sk_test_…'} value={secret()} onInput={(e,) => setSecret(e.currentTarget.value,)} />
                </FormField>
                <FormField
                    label="Webhook signing secret"
                    hint={creds()?.webhookConfigured ? `Currently set (…${creds()!.webhookSecretLast4}). Leave blank to keep it.` : 'Starts with whsec_. Verifies incoming webhooks.'}
                >
                    <input type="password" autocomplete="off" spellcheck={false} placeholder={creds()?.webhookConfigured ? '•••••••••• (unchanged)' : 'whsec_…'} value={webhook()} onInput={(e,) => setWebhook(e.currentTarget.value,)} />
                </FormField>
                <p class="form-help-muted">
                    Webhook endpoint URL: <code>{window.location.origin}/api/v1/payments/webhook</code>
                </p>
            </Show>

            <div class="shop-stripe-keys__actions">
                <button class="btn btn--primary btn--small" onClick={save} disabled={saving()}>
                    {saving() ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
};

export default StripeKeysEditor;
