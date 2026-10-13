/**
 * Applying for a membership level that REQUIRES APPROVAL.
 *
 *   ApplicationQuestions  the level's application form (a Forms entity), or the
 *                         built-in Name / Email / Phone / Occupation form, in
 *                         FormRenderer's COLLECT mode — the answers travel with
 *                         the application instead of being submitted alone.
 *   ApplicationPayment    a card saved with a SetupIntent (NOT charged), then
 *                         `cms.payments.applyMembership`. Billing starts only
 *                         when an admin approves.
 *   ApplyModal            both, for a signed-in member (/subscribe, profile).
 *
 * The sign-up flow (SubscriptionSignup) uses the two parts as its own steps.
 */
import type { Form, FormAnswer, MembershipApplyResponse, MembershipTierOption, } from '@sitesurge/types';
import { DEFAULT_APPLICATION_FIELDS, } from '@sitesurge/types';
import { Component, createResource, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { billedNote, shownPrice, } from '../../utils/membershipFormat';
import { mountStripeCard, saveCardForLater, type MountedCard, } from '../../utils/stripeCard';
import FormRenderer from '../forms/FormRenderer';
import { Portal, } from 'solid-js/web';
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
    onCollected: (answers: FormAnswer[], form: Form,) => void;
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

export const ApplicationPayment: Component<{
    tier: MembershipTierOption;
    answers: FormAnswer[];
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
            const res = await cms.payments.applyMembership({ tierId: props.tier.id, answers: props.answers, paymentMethodId, },);
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
                <strong>{props.tier.name}</strong> · {shownPrice(props.tier,)}
                <Show when={billedNote(props.tier,)}> <small>({billedNote(props.tier,)})</small></Show>
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
                    {busy() ? 'Sending…' : 'Submit application'}
                </button>
            </div>
        </div>
    );
};

/** "Thanks — pending approval" (shared by the modal and the sign-up flow). */
export const ApplicationDone: Component<{ tierName: string; }> = (props,) => (
    <div class="membership-apply__done">
        <h3>Application received</h3>
        <p>
            Thank you for applying for <strong>{props.tierName}</strong>. Our team will review it and email you.
            Your card is saved but <strong>will not be charged unless your application is approved</strong>.
        </p>
    </div>
);

/** Apply for a level, signed in: questions → card → done. */
export const ApplyModal: Component<{ tier: MembershipTierOption; onClose: () => void; onApplied: () => void; }> = (props,) => {
    const auth = useAuth();
    const [step, setStep,] = createSignal<'questions' | 'payment' | 'done'>('questions',);
    const [answers, setAnswers,] = createSignal<FormAnswer[]>([],);
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
                    <p class="membership-apply__muted">This membership requires approval. Tell us about yourself:</p>
                    <ApplicationQuestions
                        tier={props.tier}
                        prefill={{ name: auth.user?.displayName, email: auth.user?.email, }}
                        onCollected={(a,) => { setAnswers(a,); setStep('payment',); }}
                    />
                </Show>
                <Show when={step() === 'payment'}>
                    <ApplicationPayment
                        tier={props.tier}
                        answers={answers()}
                        onBack={() => setStep('questions',)}
                        onDone={() => { setStep('done',); void auth.refreshUser(); props.onApplied(); }}
                    />
                </Show>
                <Show when={step() === 'done'}>
                    <ApplicationDone tierName={props.tier.name} />
                    <div class="membership-apply__actions">
                        <button type="button" class="btn btn--primary" onClick={() => props.onClose()}>Close</button>
                    </div>
                </Show>
            </div>
        </div>
        </Portal>
    );
};
