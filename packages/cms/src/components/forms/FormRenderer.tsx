import type {
    ChoiceSummary,
    Form,
    FormAnswer,
    FormQuestion,
    FormResults,
    NumberSummary,
    QuestionResult,
    TextSummary,
} from '@sitesurge/types';
import { Component, createSignal, For, Match, Show, Switch, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import './FormRenderer.scss';

interface FormRendererProps {
    form: Form;
    /** If true, shows inline (no page wrapper padding) */
    inline?: boolean;
    /** Title control (from `{{form(id, title=…)}}`): `false`/`''` hides the
     *  title; a non-empty string overrides it; otherwise the form's own title. */
    title?: boolean | string;
    /** Lay the fields out in this many columns (wrapping after), 1–8.
     *  Collapses to a single column on mobile. Default 1. */
    columns?: number;
}

/**
 * Reusable form renderer. Handles rendering questions, collecting answers,
 * submitting, showing success, and displaying results if enabled.
 * Can be embedded on any page or inside blocks.
 */
/** Stable per-render idempotency token so a double-click / accidental resubmit
 *  is deduped server-side (see form_submissions.nonce). */
function makeNonce(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch { /* fall through */ }
    return `n-${Date.now()}-${String(Math.trunc(performance.now(),),)}`;
}

const FormRenderer: Component<FormRendererProps> = (props,) => {
    const submissionNonce = makeNonce();

    /** Effective title text, or null when it should be hidden. */
    const titleText = (): string | null => {
        const t = props.title;
        if (t === false || t === '') return null;
        if (typeof t === 'string') return t;
        return props.form.title || null;
    };
    /** Column count for the fields grid (1–8). */
    const cols = (): number => Math.max(1, Math.min(8, Math.trunc(Number(props.columns,) || 1,),),);
    const [answers, setAnswers,] = createSignal<Record<string, unknown>>({},);
    const [submitted, setSubmitted,] = createSignal(false,);
    const [submitting, setSubmitting,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [results, setResults,] = createSignal<FormResults | null>(null,);
    const [loadingResults, setLoadingResults,] = createSignal(false,);
    const [fieldErrors, setFieldErrors,] = createSignal<Record<string, string>>({},);

    const updateAnswer = (questionId: string, value: unknown,) => {
        setAnswers(prev => ({ ...prev, [questionId]: value, }),);
        // Clear a field's error as soon as the visitor edits it.
        if (fieldErrors()[questionId]) {
            setFieldErrors(prev => {
                const next = { ...prev, };
                delete next[questionId];
                return next;
            },);
        }
    };

    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    /** Validate one answer against its question's rules → error message or null. */
    const validateQuestion = (q: FormQuestion, value: unknown,): string | null => {
        const empty = value == null || value === '' || (Array.isArray(value,) && value.length === 0);
        if (q.isRequired && empty) return 'This field is required.';
        if (empty) return null;
        const v = q.validation;
        if (q.type === 'email' && typeof value === 'string' && !EMAIL_RE.test(value,)) {
            return 'Enter a valid email address.';
        }
        if (typeof value === 'string' && (q.type === 'text' || q.type === 'textarea' || q.type === 'email')) {
            if (v?.minLength && value.length < v.minLength) return `Must be at least ${v.minLength} characters.`;
            if (v?.maxLength && value.length > v.maxLength) return `Must be ${v.maxLength} characters or fewer.`;
            if (v?.pattern) {
                try {
                    if (!new RegExp(v.pattern,).test(value,)) return v.patternMessage || 'Please match the requested format.';
                } catch { /* invalid stored pattern — skip */ }
            }
        }
        if (q.type === 'number' && typeof value === 'number' && !Number.isNaN(value,)) {
            if (v?.min != null && value < v.min) return `Must be at least ${v.min}.`;
            if (v?.max != null && value > v.max) return `Must be at most ${v.max}.`;
        }
        return null;
    };

    const validateAll = (): Record<string, string> => {
        const errs: Record<string, string> = {};
        for (const q of props.form.questions) {
            const err = validateQuestion(q, answers()[q.id],);
            if (err) errs[q.id] = err;
        }
        return errs;
    };

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setError('',);

        const errs = validateAll();
        setFieldErrors(errs,);
        if (Object.keys(errs,).length > 0) return;

        setSubmitting(true,);

        try {
            const formAnswers = Object.entries(answers(),).map(([questionId, value,],) => ({
                questionId,
                value,
            }),) as FormAnswer[];
            await cms.forms.submit(props.form.slug, { answers: formAnswers, nonce: submissionNonce, },);
            setSubmitted(true,);
            if (props.form.showResults) loadResults();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'An error occurred. Please try again.',);
        } finally {
            setSubmitting(false,);
        }
    };

    const loadResults = async () => {
        setLoadingResults(true,);
        try {
            setResults(await cms.forms.results(props.form.slug,) as FormResults,);
        } catch {
            // Non-critical — leave results unset; bus surfaces the error.
        } finally {
            setLoadingResults(false,);
        }
    };

    return (
        <div class={`form-renderer ${props.inline ? 'form-renderer--inline' : ''}`}>
            <Show when={titleText()}>
                <h2 class="form-renderer__title">{titleText()}</h2>
            </Show>
            <Show when={props.form.description}>
                <p class="form-renderer__subtitle">{props.form.description}</p>
            </Show>

            <Show
                when={submitted()}
                fallback={
                    <form
                        onSubmit={handleSubmit}
                        class="form-renderer__form"
                        classList={{ 'form-renderer__form--cols': cols() > 1, }}
                        style={cols() > 1 ? { '--form-cols': String(cols(),), } : undefined}
                        noValidate
                    >
                        <For each={props.form.questions}>
                            {(q: FormQuestion,) => (
                                <div
                                    class="form-renderer__field"
                                    classList={{
                                        'form-renderer__field--invalid': !!fieldErrors()[q.id],
                                        'form-renderer__field--half': q.width === 'half',
                                    }}
                                >
                                    <Show when={!q.questionAsPlaceholder}>
                                        <label class="form-renderer__label">
                                            {q.question}
                                            <Show when={q.isRequired}>
                                                <span class="form-renderer__required">*</span>
                                            </Show>
                                        </label>
                                    </Show>
                                    <Show when={q.description}>
                                        <p class="form-renderer__description">{q.description}</p>
                                    </Show>

                                    <Switch>
                                        <Match when={q.type === 'text'}>
                                            <input
                                                type="text"
                                                class="form-renderer__input"
                                                required={q.isRequired}
                                                minLength={q.validation?.minLength}
                                                maxLength={q.validation?.maxLength}
                                                pattern={q.validation?.pattern}
                                                title={q.validation?.patternMessage}
                                                placeholder={q.questionAsPlaceholder ? q.question : (q.placeholder || '')}
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'textarea'}>
                                            <textarea
                                                class="form-renderer__textarea"
                                                rows={q.rows ?? 4}
                                                required={q.isRequired}
                                                minLength={q.validation?.minLength}
                                                maxLength={q.validation?.maxLength}
                                                placeholder={q.questionAsPlaceholder ? q.question : (q.placeholder || '')}
                                                style={{
                                                    resize: (q.allowResize ?? true) ? 'vertical' : 'none',
                                                    ...(q.maxHeight ? { 'max-height': q.maxHeight, } : {}),
                                                }}
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'number'}>
                                            <input
                                                type="number"
                                                class="form-renderer__input form-renderer__input--number"
                                                required={q.isRequired}
                                                inputmode="numeric"
                                                min={q.validation?.min}
                                                max={q.validation?.max}
                                                placeholder={q.questionAsPlaceholder ? q.question : (q.placeholder || '')}
                                                onInput={(e,) => updateAnswer(q.id, Number(e.currentTarget.value,),)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'email'}>
                                            <input
                                                type="email"
                                                class="form-renderer__input"
                                                required={q.isRequired}
                                                inputmode="email"
                                                autocomplete="email"
                                                maxLength={q.validation?.maxLength}
                                                placeholder={q.questionAsPlaceholder ? q.question : (q.placeholder || '')}
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'date'}>
                                            <input
                                                type="date"
                                                class="form-renderer__input form-renderer__input--date"
                                                required={q.isRequired}
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'select'}>
                                            <select
                                                class="form-renderer__select"
                                                required={q.isRequired}
                                                onChange={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            >
                                                <option value="">Select an option...</option>
                                                <For each={q.options || []}>
                                                    {(opt,) => <option value={opt}>{opt}</option>}
                                                </For>
                                            </select>
                                        </Match>

                                        <Match when={q.type === 'radio'}>
                                            <div class="form-renderer__options">
                                                <For each={q.options || []}>
                                                    {(opt,) => (
                                                        <label class="form-renderer__option">
                                                            <input
                                                                type="radio"
                                                                name={q.id}
                                                                value={opt}
                                                                class="form-renderer__radio"
                                                                onChange={() => updateAnswer(q.id, opt,)}
                                                            />
                                                            <span class="form-renderer__option-label">{opt}</span>
                                                        </label>
                                                    )}
                                                </For>
                                            </div>
                                        </Match>

                                        <Match when={q.type === 'checkbox'}>
                                            <div class="form-renderer__options">
                                                <For each={q.options || []}>
                                                    {(opt,) => (
                                                        <label class="form-renderer__option">
                                                            <input
                                                                type="checkbox"
                                                                value={opt}
                                                                class="form-renderer__checkbox"
                                                                onChange={(e,) => {
                                                                    const current = (answers()[q.id] as string[] | undefined) || [];
                                                                    if (e.currentTarget.checked) {
                                                                        updateAnswer(q.id, [...current, opt,],);
                                                                    } else {
                                                                        updateAnswer(q.id, current.filter(v => v !== opt),);
                                                                    }
                                                                }}
                                                            />
                                                            <span class="form-renderer__option-label">{opt}</span>
                                                        </label>
                                                    )}
                                                </For>
                                            </div>
                                        </Match>
                                    </Switch>

                                    <Show when={fieldErrors()[q.id]}>
                                        <span class="form-renderer__field-error" role="alert">
                                            {fieldErrors()[q.id]}
                                        </span>
                                    </Show>
                                </div>
                            )}
                        </For>

                        <Show when={error()}>
                            <div class="form-renderer__error">{error()}</div>
                        </Show>

                        <div class="form-renderer__submit-row">
                            <button
                                type="submit"
                                class="form-renderer__submit"
                                disabled={submitting()}
                            >
                                {submitting()
                                    ? 'Submitting...'
                                    : (props.form.submitButtonText?.trim() || 'Submit')}
                            </button>
                        </div>
                    </form>
                }
            >
                {/* Success state */}
                <div class="form-renderer__success">
                    <div class="form-renderer__success-icon">&#10003;</div>
                    <p class="form-renderer__success-message">
                        {props.form.successMessage || 'Thank you for your submission!'}
                    </p>
                </div>

                {/* Results */}
                <Show when={props.form.showResults}>
                    <Show when={loadingResults()}>
                        <div class="form-renderer__loading">Loading results...</div>
                    </Show>
                    <Show when={results()}>
                        {(r,) => (
                            <div class="form-renderer__results">
                                <h3 class="form-renderer__results-title">Results</h3>
                                <p class="form-renderer__results-count">
                                    {r().totalSubmissions} submission{r().totalSubmissions !== 1 ? 's' : ''}
                                </p>
                                <For each={r().questionResults}>
                                    {(qr: QuestionResult,) => (
                                        <div class="form-renderer__result-item">
                                            <h4>{qr.question}</h4>
                                            <span class="form-renderer__result-responses">
                                                {qr.responses} response{qr.responses !== 1 ? 's' : ''}
                                            </span>
                                            <Switch>
                                                <Match when={qr.summary.type === 'choice'}>
                                                    <For each={(qr.summary as ChoiceSummary).options}>
                                                        {(option,) => (
                                                            <div class="form-renderer__bar">
                                                                <div class="form-renderer__bar-label">{option.value}</div>
                                                                <div class="form-renderer__bar-track">
                                                                    <div class="form-renderer__bar-fill" style={{ width: `${option.percentage}%`, }} />
                                                                </div>
                                                                <div class="form-renderer__bar-value">{Math.round(option.percentage,)}%</div>
                                                            </div>
                                                        )}
                                                    </For>
                                                </Match>
                                                <Match when={qr.summary.type === 'number'}>
                                                    {(() => {
                                                        const s = qr.summary as NumberSummary;
                                                        return (
                                                            <div class="form-renderer__stats">
                                                                <div class="form-renderer__stat"><span>Min</span><strong>{s.min}</strong></div>
                                                                <div class="form-renderer__stat"><span>Max</span><strong>{s.max}</strong></div>
                                                                <div class="form-renderer__stat"><span>Avg</span><strong>{s.average.toFixed(1,)}</strong></div>
                                                                <div class="form-renderer__stat"><span>Median</span><strong>{s.median}</strong></div>
                                                            </div>
                                                        );
                                                    })()}
                                                </Match>
                                                <Match when={qr.summary.type === 'text'}>
                                                    <p class="form-renderer__text-count">
                                                        {(qr.summary as TextSummary).totalResponses} text response{(qr.summary as TextSummary).totalResponses !== 1 ? 's' : ''}
                                                    </p>
                                                </Match>
                                            </Switch>
                                        </div>
                                    )}
                                </For>
                            </div>
                        )}
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default FormRenderer;
