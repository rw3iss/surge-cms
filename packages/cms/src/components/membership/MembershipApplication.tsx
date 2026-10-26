/**
 * Applying for a membership level that REQUIRES APPROVAL.
 *
 *   ApplicationQuestions  the level's application form (a Forms entity), or the
 *                         built-in Name / Email / Phone / Occupation form, in
 *                         FormRenderer's COLLECT mode — the answers travel with
 *                         the application instead of being submitted alone.
 *   submitApplication     sends the answers AT ONCE (signed in or not) — the
 *                         team is emailed and will call; a signed-out applicant
 *                         gets a token (kept in sessionStorage) to claim it.
 *   ApplicationSubmitted  "Your request has been submitted… expect a call".
 *   ApplicationPayment    a card saved with a SetupIntent (NOT charged), then
 *                         `attachMembershipApplicationCard`. Billing starts only
 *                         when an admin approves.
 *   claimApplication      a "hide price" level instead: no card — the
 *                         application is attached to the account; on approval
 *                         the member signs in, sees the pricing and pays then.
 *   ApplyModal            both, for a signed-in member (/subscribe, profile).
 *
 * The sign-up flow (SubscriptionSignup) uses the two parts as its own steps.
 */
import type { Form, FormAnswer, MembershipApplyResponse, MembershipApplySubmitResponse, MembershipTierOption, } from '@sitesurge/types';
import { DEFAULT_APPLICATION_FIELDS, } from '@sitesurge/types';
import { Component, createResource, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { siteName, } from '../../stores/siteSettings';
import { billedNote, defaultPriceId, leadPriceId, shownPrice, tierAtPrice, } from '../../utils/membershipFormat';
import PriceChoice from './PriceChoice';
import { mountStripeCard, saveCardForLater, type MountedCard, } from '../../utils/stripeCard';
import FormRenderer from '../forms/FormRenderer';
import { Portal, } from 'solid-js/web';
import { A, } from '@solidjs/router';
import './MembershipApplication.scss';

/** The built-in application form, as a Form FormRenderer can draw. */
function builtInForm(): Form {
    const now = new Date();
    return {
        id: 'membership-application', title: '', slug: '', status: 'published', showResults: false,
        allowMultipleSubmissions: true, requiresAuth: false, action: 'submit', submissionCount: 0,
        questions: DEFAULT_APPLICATION_FIELDS.map((f, i,) => ({
            id: f.id, formId: 'membership-application', type: f.type === 'email' ? 'email' : 'text', question: f.label,
            isRequired: f.required, order: i, createdAt: now, updatedAt: now,
        }),),
        createdAt: now, updatedAt: now,
    } as unknown as Form;
}

/** Pre-fill the applicant's name + email where the form asks for them. */
function prefillFor(form: Form, who: { name?: string | null; email?: string | null; },): Record<string, string> {
    const out: Record<string, string> = {};
    for (const q of form.questions) {
        const label = q.question.toLowerCase();
        if (who.email && q.type === 'email') out[q.id] = who.email;
        else if (who.name && q.type === 'text' && /^(full\s+)?name\b|your name/.test(label,)) out[q.id] = who.name;
    }
    return out;
}

/** Name + email typed into an application (to pre-fill the account step). */
export function applicantFrom(form: Form | undefined, answers: FormAnswer[],): { name: string; email: string; } {
    const by = new Map(answers.map((a,) => [a.questionId, String(a.value ?? '',).trim(),]),);
    let name = '';
    let email = '';
    for (const q of form?.questions ?? []) {
        const v = by.get(q.id,) ?? '';
        if (!email && q.type === 'email') email = v;
        if (!name && q.type === 'text' && /name/i.test(q.question,)) name = v;
    }
    return { name, email, };
}

export const ApplicationQuestions: Component<{
    tier: MembershipTierOption;
    /** May be async: a thrown error shows on the form. */
    onCollected: (answers: FormAnswer[], form: Form,) => void | Promise<void>;
    submitLabel?: string;
    prefill?: { name?: string | null; email?: string | null; };
}> = (props,) => {
    const [form,] = createResource(() => props.tier.applicationFormSlug ?? '', async (slug,) => {
        if (!slug) return builtInForm();
        try {
            const f = await cms.forms.getBySlug(slug,) as unknown as Form;
            return f?.questions?.length ? f : builtInForm();
        } catch {
            return builtInForm();
        }
    },);
    return (
        <Show when={form()} fallback={<p class="membership-apply__muted">Loading the application…</p>}>
            {(f,) => (
                <FormRenderer
                    form={f()}
                    inline
                    title={false}
                    initialAnswers={prefillFor(f(), props.prefill ?? {},)}
                    submitLabel={props.submitLabel ?? 'Continue'}
                    onCollect={(answers,) => props.onCollected(answers, f(),)}
                />
            )}
        </Show>
    );
};

const PENDING_KEY = 'sitesurge.membership.application';

/** The application submitted from this browser (to claim after sign-up). */
export interface SubmittedApplication {
    id: string;
    token: string | null;
    tierId: string;
    /** The price chosen when it was submitted (null = the level's default) — approval bills it. */
    priceId?: string | null;
}

export function rememberedApplication(tierId: string,): SubmittedApplication | null {
    try {
        const v = JSON.parse(sessionStorage.getItem(PENDING_KEY,) ?? 'null',) as SubmittedApplication | null;
        return v && v.tierId === tierId ? v : null;
    } catch {
        return null;
    }
}

/** Step 1: send the answers now (the team is emailed and will call). */
export async function submitApplication(tier: MembershipTierOption, answers: FormAnswer[], priceId?: string | null,): Promise<SubmittedApplication> {
    // Only a NON-default price is sent (the server treats "omitted" as the default).
    const alt = priceId && priceId !== defaultPriceId(tier,) ? priceId : null;
    const res: MembershipApplySubmitResponse = await cms.payments.submitMembershipApplication({
        tierId: tier.id, answers, ...(alt ? { priceId: alt, } : {}),
    },);
    const saved = { id: res.application.id, token: res.token, tierId: tier.id, priceId: alt, };
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(saved,),); } catch { /* private mode */ }
    return saved;
}

export function forgetApplication(): void {
    try { sessionStorage.removeItem(PENDING_KEY,); } catch { /* ignore */ }
}

/** "Hide price" levels: attach the sent application to the (new) account — no card. */
export async function claimApplication(app: SubmittedApplication,): Promise<MembershipApplyResponse> {
    const res = await cms.payments.claimMembershipApplication({ applicationId: app.id, token: app.token, },);
    forgetApplication();
    return res;
}

/** Shown right after the answers are sent. */
export const ApplicationSubmitted: Component<{ tierName: string; signedIn: boolean; onContinue: () => void; noCard?: boolean; busy?: boolean; }> = (props,) => (
    <div class="membership-apply__submitted" role="status">
        <h3>Your request has been submitted</h3>
        <p>
            Thank you for applying for <strong>{props.tierName}</strong>. Expect a phone call from someone from {siteName()} soon.
        </p>
        <p class="membership-apply__muted">
            {props.noCard
                ? props.signedIn
                    ? 'Once you are approved, sign in to see the pricing, choose your billing and start your membership.'
                    : 'Next, create your account. Once you are approved, sign in to see the pricing, choose your billing and start your membership.'
                : props.signedIn
                ? 'Next, add the card for your membership — you will not be charged unless your application is approved.'
                : 'Next, create your account and add your card — you will not be charged unless your application is approved.'}
        </p>
        <div class="membership-apply__actions">
            <button type="button" class="btn btn--primary" disabled={props.busy} onClick={() => props.onContinue()}>
                {props.noCard ? (props.signedIn ? 'Finish' : 'Create my account') : props.signedIn ? 'Add my card' : 'Create my account'}
            </button>
        </div>
    </div>
);

export const ApplicationPayment: Component<{
    tier: MembershipTierOption;
    /** The application submitted in step 1. */
    application: SubmittedApplication;
    onDone: (res: MembershipApplyResponse,) => void;
    onBack?: () => void;
}> = (props,) => {
    const [error, setError,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    let mounted: MountedCard | null = null;
    onCleanup(() => mounted?.card.destroy(),);
    const mount = (el: HTMLDivElement,) => {
        void mountStripeCard(el,).then((m,) => { mounted = m; },).catch((e: Error,) => setError(e.message,),);
    };
    const submit = async () => {
        setError('',);
        if (!mounted) return setError('Enter your card details.',);
        setBusy(true,);
        try {
            const paymentMethodId = await saveCardForLater(mounted,);
            const res = await cms.payments.attachMembershipApplicationCard({
                applicationId: props.application.id, token: props.application.token, paymentMethodId,
            },);
            forgetApplication();
            props.onDone(res,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Your application could not be sent.',);
        } finally {
            setBusy(false,);
        }
    };
    return (
        <div class="membership-apply__payment">
            <p class="membership-apply__summary">
                <strong>{props.tier.name}</strong> · {shownPrice(tierAtPrice(props.tier, props.application.priceId,),)}
                <Show when={billedNote(tierAtPrice(props.tier, props.application.priceId,),)}> <small>({billedNote(tierAtPrice(props.tier, props.application.priceId,),)})</small></Show>
            </p>
            <p class="membership-apply__note">
                Add the card for your membership. <strong>You will not be charged now</strong> — billing starts only if your application is approved.
            </p>
            <div class="membership-apply__card" ref={mount} />
            <Show when={error()}><p class="membership-apply__error" role="alert">{error()}</p></Show>
            <div class="membership-apply__actions">
                <Show when={props.onBack}>
                    <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => props.onBack!()}>Back</button>
                </Show>
                <button type="button" class="btn btn--primary" disabled={busy()} onClick={() => void submit()}>
                    {busy() ? 'Saving…' : 'Save card & finish'}
                </button>
            </div>
        </div>
    );
};

/** "Thanks — pending approval" (shared by the modal and the sign-up flow): the
 *  ONE confirmation after applying. `program` = an "Add its role only" level
 *  (no billing, so no pricing line). */
export const ApplicationDone: Component<{ tierName: string; noCard?: boolean; program?: boolean; signedOut?: boolean; }> = (props,) => (
    <div class="membership-apply__done" role="status">
        <h3>Your request has been submitted</h3>
        <p>
            Thank you for applying for <strong>{props.tierName}</strong>. Expect a phone call from someone from {siteName()} soon;
            we will also email you once your application is reviewed.
        </p>
        <Show when={!props.program}>
            <p class="membership-apply__muted">
                <Show
                    when={props.noCard}
                    fallback={<>Your card is saved but <strong>will not be charged unless your application is approved</strong>.</>}
                >
                    <strong>Nothing is charged now.</strong> When you are approved, sign in to see the pricing, choose your billing and start your membership.
                </Show>
            </p>
        </Show>
        <Show when={props.signedOut}>
            <p class="membership-apply__muted">
                Create your account with the same email address to follow your application — it is attached to your account when you sign up.
            </p>
        </Show>
    </div>
);

/** Apply for a level, signed in: questions → card → done. */
export const ApplyModal: Component<{
    tier: MembershipTierOption;
    /** The price picked on the card (null = the default); changeable here before submitting. */
    priceId?: string | null;
    onClose: () => void;
    onApplied: () => void;
}> = (props,) => {
    const auth = useAuth();
    // Billing is chosen BEFORE the answers are sent: the application records it.
    const [price, setPrice,] = createSignal<string | null>(props.priceId ?? leadPriceId(props.tier,),);
    const [step, setStep,] = createSignal<'questions' | 'submitted' | 'payment' | 'done'>('questions',);
    const [submitted, setSubmitted,] = createSignal<SubmittedApplication | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    /** "Hide price" level: no billing choice and no card — the application is all. */
    const noCard = () => !!props.tier.priceHidden;
    const finishNoCard = async () => {
        const app = submitted();
        if (!app) return;
        setBusy(true,);
        setError('',);
        try {
            await claimApplication(app,);
            setStep('done',);
            void auth.refreshUser();
            props.onApplied();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Your application could not be sent.',);
        } finally {
            setBusy(false,);
        }
    };
    // Esc closes (the backdrop does not: an application is easy to lose by a stray click).
    onMount(() => {
        const onKey = (e: KeyboardEvent,) => { if (e.key === 'Escape') props.onClose(); };
        document.addEventListener('keydown', onKey,);
        onCleanup(() => document.removeEventListener('keydown', onKey,),);
    },);
    return (
        <Portal>
        <div class="membership-apply-overlay" role="dialog" aria-modal="true" aria-label={`Apply for ${props.tier.name}`}>
            <div class="membership-apply membership-apply--modal">
                <button type="button" class="membership-apply__close" aria-label="Close" onClick={() => props.onClose()}>×</button>
                <h2 class="membership-apply__title">Apply for {props.tier.name}</h2>
                <Show when={step() === 'questions'}>
                    <Show when={!noCard() && (props.tier.prices?.length ?? 0) > 1}>
                        <div class="membership-apply__billing">
                            <span class="membership-apply__label">Billing</span>
                            <PriceChoice tier={props.tier} selected={price()} onSelect={setPrice} />
                        </div>
                    </Show>
                    <p class="membership-apply__muted">This {props.tier.roleOnly ? 'program' : 'membership'} requires approval. Tell us about yourself:</p>
                    <ApplicationQuestions
                        tier={props.tier}
                        prefill={{ name: auth.user?.displayName, email: auth.user?.email, }}
                        onCollected={async (a,) => {
                            setSubmitted(await submitApplication(props.tier, a, noCard() ? null : price(),),);
                            void auth.refreshUser();
                            props.onApplied();
                            // No card to add (programs, "Hide price" levels): complete it now
                            // and show the ONE confirmation. A failure falls back to the
                            // submitted step, whose Finish retries.
                            if (noCard() && !auth.user) {
                                // Signed out: the application is in; it attaches to the account
                                // made later with this email (sign-up / verified sign-in).
                                setStep('done',);
                            } else if (noCard()) {
                                await finishNoCard();
                                if (step() !== 'done') setStep('submitted',);
                            } else {
                                setStep('submitted',);
                            }
                        }}
                    />
                </Show>
                <Show when={step() === 'submitted'}>
                    <ApplicationSubmitted
                        tierName={props.tier.name}
                        signedIn
                        noCard={noCard()}
                        busy={busy()}
                        onContinue={() => (noCard() ? void finishNoCard() : setStep('payment',))}
                    />
                    <Show when={error()}><p class="membership-apply__error" role="alert">{error()}</p></Show>
                </Show>
                <Show when={step() === 'payment' && submitted()}>
                    <ApplicationPayment
                        tier={props.tier}
                        application={submitted()!}
                        onDone={() => { setStep('done',); void auth.refreshUser(); props.onApplied(); }}
                    />
                </Show>
                <Show when={step() === 'done'}>
                    <ApplicationDone tierName={props.tier.name} noCard={noCard()} program={!!props.tier.roleOnly} signedOut={!auth.user} />
                    <div class="membership-apply__actions">
                        <Show when={!auth.user}>
                            <A href="/join" class="btn btn--outline" onClick={() => props.onClose()}>Create my account</A>
                        </Show>
                        <button type="button" class="btn btn--primary" onClick={() => props.onClose()}>Finish</button>
                    </div>
                </Show>
            </div>
        </div>
        </Portal>
    );
};
