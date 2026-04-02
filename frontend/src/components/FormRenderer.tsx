import type {
    ChoiceSummary,
    Form,
    FormQuestion,
    FormResults,
    NumberSummary,
    QuestionResult,
    TextSummary,
} from '@surge/shared';
import { Component, createSignal, For, Match, Show, Switch, } from 'solid-js';
import { fetchFormResults, submitForm, } from '../services/api';
import './FormRenderer.scss';

interface FormRendererProps {
    form: Form;
    /** If true, shows inline (no page wrapper padding) */
    inline?: boolean;
}

/**
 * Reusable form renderer. Handles rendering questions, collecting answers,
 * submitting, showing success, and displaying results if enabled.
 * Can be embedded on any page or inside blocks.
 */
const FormRenderer: Component<FormRendererProps> = (props,) => {
    const [answers, setAnswers,] = createSignal<Record<string, unknown>>({},);
    const [submitted, setSubmitted,] = createSignal(false,);
    const [submitting, setSubmitting,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [results, setResults,] = createSignal<FormResults | null>(null,);
    const [loadingResults, setLoadingResults,] = createSignal(false,);

    const updateAnswer = (questionId: string, value: unknown,) => {
        setAnswers(prev => ({ ...prev, [questionId]: value, }),);
    };

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        setSubmitting(true,);

        try {
            const formAnswers = Object.entries(answers(),).map(([questionId, value,],) => ({
                questionId,
                value,
            }),);
            const response = await submitForm(props.form.slug, formAnswers,);
            if (response.success) {
                setSubmitted(true,);
                if (props.form.showResults) loadResults();
            } else {
                setError((response as any).error?.message || 'Submission failed',);
            }
        } catch {
            setError('An error occurred. Please try again.',);
        } finally {
            setSubmitting(false,);
        }
    };

    const loadResults = async () => {
        setLoadingResults(true,);
        try {
            const response = await fetchFormResults(props.form.slug,);
            if (response.success) setResults(response.data as FormResults,);
        } finally {
            setLoadingResults(false,);
        }
    };

    return (
        <div class={`form-renderer ${props.inline ? 'form-renderer--inline' : ''}`}>
            <Show
                when={submitted()}
                fallback={
                    <form onSubmit={handleSubmit} class="form-renderer__form">
                        <For each={props.form.questions}>
                            {(q: FormQuestion,) => (
                                <div class="form-renderer__field">
                                    <label class="form-renderer__label">
                                        {q.question}
                                        <Show when={q.isRequired}>
                                            <span class="form-renderer__required">*</span>
                                        </Show>
                                    </label>
                                    <Show when={q.description}>
                                        <p class="form-renderer__description">{q.description}</p>
                                    </Show>

                                    <Switch>
                                        <Match when={q.type === 'text'}>
                                            <input
                                                type="text"
                                                class="form-renderer__input"
                                                required={q.isRequired}
                                                placeholder="Your answer"
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'textarea'}>
                                            <textarea
                                                class="form-renderer__textarea"
                                                rows={4}
                                                required={q.isRequired}
                                                placeholder="Your answer"
                                                onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'number'}>
                                            <input
                                                type="number"
                                                class="form-renderer__input form-renderer__input--number"
                                                required={q.isRequired}
                                                placeholder="0"
                                                onInput={(e,) => updateAnswer(q.id, Number(e.currentTarget.value,),)}
                                            />
                                        </Match>

                                        <Match when={q.type === 'email'}>
                                            <input
                                                type="email"
                                                class="form-renderer__input"
                                                required={q.isRequired}
                                                placeholder="you@example.com"
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
                                </div>
                            )}
                        </For>

                        <Show when={error()}>
                            <div class="form-renderer__error">{error()}</div>
                        </Show>

                        <button
                            type="submit"
                            class="form-renderer__submit"
                            disabled={submitting()}
                        >
                            {submitting() ? 'Submitting...' : 'Submit'}
                        </button>
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
