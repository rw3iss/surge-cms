/**
 * Settings → General → Reply tracking: what happens to a reply or message
 * after it is sent from the admin (donations, form submissions, users).
 *
 *   Delivery reports  Amazon SES event publishing → SNS → our webhook:
 *                     delivered / delayed / bounced / marked as spam.
 *   Opens             a 1×1 image (approximate).
 *   Clicks            links pass through a recording redirect.
 *
 * Each switch saves at once; the configuration set name saves on blur.
 * Applies to replies sent from now on.
 */
import type { ReplyTrackingSettingsBody, ReplyTrackingStatus, } from '@sitesurge/types';
import { formatDateTime, formatRelativeTime, } from '@sitesurge/types';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import './ReplyTrackingPanel.scss';

const EVENT_NAMES: Record<string, string> = {
    send: 'Send', delivery: 'Delivery', delay: 'Delay', bounce: 'Bounce', complaint: 'Spam report', reject: 'Reject', open: 'Open', click: 'Click',
};

const ReplyTrackingPanel: Component = () => {
    const toast = useToast();
    const [s, setS,] = createSignal<ReplyTrackingStatus | null>(null,);
    const [error, setError,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [configSet, setConfigSet,] = createSignal('',);
    const [rotateOpen, setRotateOpen,] = createSignal(false,);
    const [rotating, setRotating,] = createSignal(false,);
    let configInput: HTMLInputElement | undefined;

    const apply = (next: ReplyTrackingStatus,) => {
        setS(next,);
        if (document.activeElement !== configInput) setConfigSet(next.configurationSet,);
    };

    const load = async () => {
        try {
            apply(await cms.replies.trackingSettings(),);
        } catch (e) {
            setError((e as Error)?.message || 'Could not load reply tracking.',);
        }
    };
    onMount(load,);

    const save = async (patch: ReplyTrackingSettingsBody, done = 'Saved.',) => {
        setSaving(true,);
        try {
            apply(await cms.replies.updateTrackingSettings(patch,),);
            toast.success(done,);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not save.',);
            void load();
        } finally {
            setSaving(false,);
        }
    };

    const commitConfigSet = () => {
        const v = configSet().trim();
        if (v !== (s()?.configurationSet ?? '')) void save({ configurationSet: v, }, v ? `Configuration set "${v}" saved.` : 'Configuration set cleared.',);
    };

    const copy = async (text: string,) => {
        try {
            await navigator.clipboard.writeText(text,);
            toast.success('Copied.',);
        } catch {
            toast.error('Could not copy — select the text and copy it by hand.',);
        }
    };

    const rotate = async () => {
        setRotating(true,);
        try {
            apply(await cms.replies.rotateTrackingWebhook(),);
            toast.success('New webhook URL issued. Update the SNS subscription.',);
            setRotateOpen(false,);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not rotate.',);
        } finally {
            setRotating(false,);
        }
    };

    return (
        <section class="settings-card reply-tracking">
            <h3 class="settings-card__title">Reply Tracking</h3>
            <p class="settings-card__lede">
                What happens to a reply or message after you send it from the admin (donations, form submissions, users).
                The result shows next to each reply. Changes apply to replies sent from now on.
            </p>

            <Show when={s()} fallback={<p class="form-help-muted">{error() || 'Loading…'}</p>}>
                {(st,) => (
                    <>
                        {/* ─── Delivery reports ─── */}
                        <div class="reply-tracking__group">
                            <Toggle
                                checked={st().deliveryEvents}
                                disabled={saving()}
                                onChange={(v,) => void save({ deliveryEvents: v, }, v ? 'Delivery reports on.' : 'Delivery reports off.',)}
                                label="Delivery reports (Amazon SES)"
                                hint="Delivered, delayed, bounced and marked-as-spam, reported by SES through an SNS topic."
                            />

                            <Show when={st().deliveryEvents}>
                                <div class="reply-tracking__detail">
                                    <FormField
                                        label="Configuration Set"
                                        tooltip="The SES configuration set that publishes events to your SNS topic. Sent with each reply as X-SES-CONFIGURATION-SET. Leave empty when the sending identity has a default configuration set."
                                        hint="Letters, numbers, - and _. Saved when you leave the field."
                                    >
                                        <input
                                            ref={configInput}
                                            type="text"
                                            placeholder="e.g. replies"
                                            value={configSet()}
                                            onInput={(e,) => setConfigSet(e.currentTarget.value,)}
                                            onBlur={commitConfigSet}
                                            onKeyDown={(e,) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                                        />
                                    </FormField>

                                    <FormField
                                        label="SNS Webhook URL"
                                        tooltip="Create an HTTPS subscription on your SNS topic with this URL. The subscription is confirmed automatically. Keep it private: it contains a secret token."
                                    >
                                        <div class="reply-tracking__url">
                                            <input type="text" readOnly value={st().webhookUrl} onFocus={(e,) => e.currentTarget.select()} />
                                            <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => void copy(st().webhookUrl,)}>
                                                Copy
                                            </button>
                                            <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={() => setRotateOpen(true,)}>
                                                New URL…
                                            </button>
                                        </div>
                                    </FormField>

                                    <dl class="reply-tracking__status">
                                        <dt>Subscription</dt>
                                        <dd>
                                            <Show
                                                when={st().topicArn}
                                                fallback={<span class="reply-tone--warn">Not confirmed yet — create the SNS subscription (steps below).</span>}
                                            >
                                                <span class="reply-tone--ok">Confirmed</span>{' '}
                                                <span class="form-help-muted">
                                                    {st().topicArn}
                                                    {st().subscriptionConfirmedAt ? ` · ${formatDateTime(st().subscriptionConfirmedAt!,)}` : ''}
                                                </span>
                                            </Show>
                                        </dd>
                                        <dt>Last event</dt>
                                        <dd>
                                            <Show when={st().lastEventAt} fallback={<span class="form-help-muted">None received yet</span>}>
                                                {EVENT_NAMES[st().lastEventType ?? ''] ?? st().lastEventType} ·{' '}
                                                <span title={formatDateTime(st().lastEventAt!,)}>{formatRelativeTime(st().lastEventAt!,)}</span>
                                            </Show>
                                        </dd>
                                        <dt>Last 30 days</dt>
                                        <dd>{st().eventsLast30Days.toLocaleString()} events</dd>
                                    </dl>

                                    <details class="reply-tracking__setup">
                                        <summary>How to set this up in AWS</summary>
                                        <ol>
                                            <li>
                                                <strong>SNS:</strong> create a Standard topic (e.g. <code>ses-reply-events</code>) in the same region as SES.
                                            </li>
                                            <li>
                                                Add a subscription to the topic: protocol <strong>HTTPS</strong>, endpoint = the webhook URL above.
                                                This page shows <em>Confirmed</em> a few seconds later.
                                            </li>
                                            <li>
                                                <strong>SES → Configuration sets:</strong> create a set (e.g. <code>replies</code>) and add an
                                                event destination of type <strong>Amazon SNS</strong> → your topic, with the event types
                                                Delivery, Bounce, Complaint, Reject and Delivery delay. Leave SES open and click tracking off when the
                                                switches below are on (they would count twice).
                                            </li>
                                            <li>
                                                Enter the configuration set name above. If you send through <strong>Mail Manager</strong>, also
                                                give its "Send to internet" role <code>ses:SendRawEmail</code> on the configuration set, or set
                                                the set as the default for your sending identity (SES → Identities → your domain → Configuration
                                                set) — that works whatever the relay does with the header.
                                            </li>
                                            <li>Send a test reply. The last event above changes to <em>Delivery</em>.</li>
                                        </ol>
                                    </details>
                                </div>
                            </Show>
                        </div>

                        {/* ─── Opens & clicks ─── */}
                        <div class="reply-tracking__group">
                            <Toggle
                                checked={st().trackOpens}
                                disabled={saving()}
                                onChange={(v,) => void save({ trackOpens: v, }, v ? 'Open tracking on.' : 'Open tracking off.',)}
                                label="Track opens"
                                hint="Adds an invisible image to each reply. Approximate: Apple Mail can open mail automatically, and mail apps that block images hide real opens."
                            />
                            <Toggle
                                checked={st().trackClicks}
                                disabled={saving()}
                                onChange={(v,) => void save({ trackClicks: v, }, v ? 'Click tracking on.' : 'Click tracking off.',)}
                                label="Track link clicks"
                                hint="Links in a reply go through your site first, which records the click and forwards the reader."
                            />
                        </div>
                    </>
                )}
            </Show>

            <ConfirmModal
                open={rotateOpen()}
                title="Issue a new webhook URL?"
                message="The current URL stops working at once. Delete the old SNS subscription and create a new one with the new URL, or delivery reports stop."
                confirmLabel="Issue new URL"
                busyLabel="Issuing…"
                danger
                loading={rotating()}
                onConfirm={() => void rotate()}
                onCancel={() => setRotateOpen(false,)}
            />
        </section>
    );
};

export default ReplyTrackingPanel;
