import { Link, Meta, Title, } from '@solidjs/meta';
import { useParams, } from '@solidjs/router';
import type {
    ChoiceSummary,
    Form,
    FormQuestion,
    FormResults,
    NumberSummary,
    QuestionResult,
    TextSummary,
} from '@surge/shared';
import { Component, createResource, createSignal, For, Match, Show, Switch, } from 'solid-js';
import { fetchForm, fetchFormResults, submitForm, } from '../services/api';

const FormPage: Component = () => {
    const params = useParams();
    const canonicalUrl = () => `${window.location.origin}/forms/${params.slug}`;
    const [answers, setAnswers,] = createSignal<Record<string, unknown>>({},);
    const [submitted, setSubmitted,] = createSignal(false,);
    const [results, setResults,] = createSignal<FormResults | null>(null,);
    const [loadingResults, setLoadingResults,] = createSignal(false,);

    const [form,] = createResource(() => params.slug, async (slug,) => {
        const response = await fetchForm(slug,);
        return response.success ? response.data as Form : null;
    },);

    const loadResults = async () => {
        setLoadingResults(true,);
        try {
            const response = await fetchFormResults(params.slug,);
            if (response.success) {
                setResults(response.data as FormResults,);
            }
        } finally {
            setLoadingResults(false,);
        }
    };

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        const formAnswers = Object.entries(answers(),).map(([questionId, value,],) => ({ questionId, value, }));
        const response = await submitForm(params.slug, formAnswers,);
        if (response.success) {
            setSubmitted(true,);
            const f = form();
            if (f?.showResults) {
                loadResults();
            }
        }
    };

    const updateAnswer = (questionId: string, value: unknown,) => {
        setAnswers(prev => ({ ...prev, [questionId]: value, }));
    };

    return (
        <div class="form-page container">
            <Show when={form()} fallback={<div>Loading...</div>}>
                {(f,) => (
                    <>
                        <Title>{f().title} - Surge Media</Title>
                        <Link rel="canonical" href={canonicalUrl()} />
                        <Meta property="og:title" content={f().title} />
                        <Meta property="og:description" content={f().description || ''} />
                        <Meta property="og:type" content="website" />
                        <Meta property="og:url" content={canonicalUrl()} />
                        <Meta name="twitter:card" content="summary_large_image" />
                        <Meta name="twitter:title" content={f().title} />
                        <Meta name="twitter:description" content={f().description || ''} />
                        <h1>{f().title}</h1>
                        <Show when={f().description}>
                            <p>{f().description}</p>
                        </Show>
                        <Show
                            when={submitted()}
                            fallback={
                                <form onSubmit={handleSubmit}>
                                    <For each={f().questions}>
                                        {(q: FormQuestion,) => (
                                            <div class="form-field">
                                                <label>{q.question}{q.isRequired && ' *'}</label>
                                                {q.type === 'text' && (
                                                    <input
                                                        type="text"
                                                        required={q.isRequired}
                                                        onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                                    />
                                                )}
                                                {q.type === 'textarea' && (
                                                    <textarea
                                                        required={q.isRequired}
                                                        onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                                    />
                                                )}
                                                {q.type === 'number' && (
                                                    <input
                                                        type="number"
                                                        required={q.isRequired}
                                                        onInput={(e,) =>
                                                            updateAnswer(q.id, Number(e.currentTarget.value,),)}
                                                    />
                                                )}
                                                {q.type === 'email' && (
                                                    <input
                                                        type="email"
                                                        required={q.isRequired}
                                                        onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                                    />
                                                )}
                                                {q.type === 'date' && (
                                                    <input
                                                        type="date"
                                                        required={q.isRequired}
                                                        onInput={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                                    />
                                                )}
                                                {q.type === 'select' && (
                                                    <select
                                                        required={q.isRequired}
                                                        onChange={(e,) => updateAnswer(q.id, e.currentTarget.value,)}
                                                    >
                                                        <option value="">Select...</option>
                                                        {q.options?.map(opt => <option value={opt}>{opt}</option>)}
                                                    </select>
                                                )}
                                                {q.type === 'radio' && q.options?.map(opt => (
                                                    <label>
                                                        <input
                                                            type="radio"
                                                            name={q.id}
                                                            value={opt}
                                                            onChange={() => updateAnswer(q.id, opt,)}
                                                        />{' '}
                                                        {opt}
                                                    </label>
                                                ))}
                                                {q.type === 'checkbox' && q.options?.map(opt => (
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            value={opt}
                                                            onChange={(e,) => {
                                                                const current =
                                                                    (answers()[q.id] as string[] | undefined) || [];
                                                                if (e.currentTarget.checked) {
                                                                    updateAnswer(q.id, [...current, opt,],);
                                                                } else {
                                                                    updateAnswer(q.id, current.filter(v => v !== opt),);
                                                                }
                                                            }}
                                                        />{' '}
                                                        {opt}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </For>
                                    <button type="submit">Submit</button>
                                </form>
                            }
                        >
                            <div class="success">{f().successMessage || 'Thank you for your submission!'}</div>

                            <Show when={f().showResults}>
                                <Show when={loadingResults()}>
                                    <div class="form-results-loading">Loading results...</div>
                                </Show>
                                <Show when={results()}>
                                    {(r,) => (
                                        <div class="form-results">
                                            <h2>Results</h2>
                                            <p class="form-results__count">
                                                {r().totalSubmissions}{' '}
                                                total submission{r().totalSubmissions !== 1 ? 's' : ''}
                                            </p>
                                            <For each={r().questionResults}>
                                                {(qr: QuestionResult,) => (
                                                    <div class="form-results__question">
                                                        <h3>{qr.question}</h3>
                                                        <p class="form-results__responses">
                                                            {qr.responses} response{qr.responses !== 1 ? 's' : ''}
                                                        </p>
                                                        <Switch>
                                                            <Match when={qr.summary.type === 'choice'}>
                                                                <div class="form-results__choices">
                                                                    <For each={(qr.summary as ChoiceSummary).options}>
                                                                        {(option,) => (
                                                                            <div class="result-bar">
                                                                                <div class="result-bar__label">
                                                                                    {option.value}
                                                                                </div>
                                                                                <div class="result-bar__track">
                                                                                    <div
                                                                                        class="result-bar__fill"
                                                                                        style={`width: ${option.percentage}%`}
                                                                                    />
                                                                                </div>
                                                                                <div class="result-bar__value">
                                                                                    {Math.round(option.percentage,)}%
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </For>
                                                                </div>
                                                            </Match>
                                                            <Match when={qr.summary.type === 'number'}>
                                                                {(() => {
                                                                    const s = qr.summary as NumberSummary;
                                                                    return (
                                                                        <div class="form-results__stats">
                                                                            <div class="form-results__stat">
                                                                                <span class="form-results__stat-label">
                                                                                    Min
                                                                                </span>
                                                                                <span class="form-results__stat-value">
                                                                                    {s.min}
                                                                                </span>
                                                                            </div>
                                                                            <div class="form-results__stat">
                                                                                <span class="form-results__stat-label">
                                                                                    Max
                                                                                </span>
                                                                                <span class="form-results__stat-value">
                                                                                    {s.max}
                                                                                </span>
                                                                            </div>
                                                                            <div class="form-results__stat">
                                                                                <span class="form-results__stat-label">
                                                                                    Average
                                                                                </span>
                                                                                <span class="form-results__stat-value">
                                                                                    {s.average.toFixed(1,)}
                                                                                </span>
                                                                            </div>
                                                                            <div class="form-results__stat">
                                                                                <span class="form-results__stat-label">
                                                                                    Median
                                                                                </span>
                                                                                <span class="form-results__stat-value">
                                                                                    {s.median}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </Match>
                                                            <Match when={qr.summary.type === 'text'}>
                                                                <p class="form-results__text-count">
                                                                    {(qr.summary as TextSummary).totalResponses}{' '}
                                                                    response{(qr.summary as TextSummary)
                                                                            .totalResponses !== 1 ?
                                                                        's' :
                                                                        ''}
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
                    </>
                )}
            </Show>
        </div>
    );
};

export default FormPage;
