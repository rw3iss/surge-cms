/**
 * Read-only view of a single form submission.
 *
 * The submissions TABLE is deliberately terse — one truncated cell per question
 * — which is unreadable for anything long, and a contact-form message is
 * exactly that. This renders the whole submission the way the form itself is
 * laid out: the question's own label above its answer, formatted per field
 * type so a paragraph, a multi-select and an email are visually distinct
 * rather than all collapsed to one comma-joined line.
 */
import { Component, For, Show, } from 'solid-js';
import ModalShell from '../common/ModalShell';
import './SubmissionViewModal.scss';

/** Loose shapes: this page already works in `any` from the resource layer. */
export interface ViewQuestion {
    id: string;
    question: string;
    type: string;
    description?: string | null;
    options?: string[];
}

export interface ViewSubmission {
    id: string;
    answers?: Array<{ questionId: string; value: unknown; }>;
    submittedAt?: string;
    submitted_at?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface SubmissionViewModalProps {
    open: boolean;
    form: { title?: string; questions?: ViewQuestion[]; } | null;
    submission: ViewSubmission | null;
    /** Position in the list, shown as "#12" so it matches the table. */
    index?: number;
    onClose: () => void;
    onDelete?: (id: string,) => void;
}

/** Answers arrive as string | string[] | number | boolean. */
function isEmpty(value: unknown,): boolean {
    if (value === undefined || value === null) return true;
    if (Array.isArray(value,)) return value.length === 0;
    return String(value,).trim() === '';
}

function formatDate(raw?: string,): string {
    if (!raw) return '';
    const d = new Date(raw,);
    return Number.isNaN(d.getTime(),) ? '' : d.toLocaleString();
}

const SubmissionViewModal: Component<SubmissionViewModalProps> = (props,) => {
    const questions = () => props.form?.questions ?? [];

    const answerFor = (questionId: string,): unknown =>
        (props.submission?.answers ?? []).find((a,) => a.questionId === questionId)?.value;

    const submittedAt = () =>
        formatDate(props.submission?.submittedAt ?? props.submission?.submitted_at,);

    return (
        <ModalShell
            open={props.open}
            size="md"
            showClose
            onClose={props.onClose}
            ariaLabel="Submission details"
            class="submission-view"
        >
            <header class="submission-view__head">
                <h2>
                    Submission
                    <Show when={props.index !== undefined}>
                        <span class="submission-view__index"> #{props.index}</span>
                    </Show>
                </h2>
                <Show when={submittedAt()}>
                    <p class="submission-view__meta">{submittedAt()}</p>
                </Show>
            </header>

            <div class="submission-view__body">
                <Show
                    when={questions().length > 0}
                    fallback={<p class="submission-view__empty">This form has no fields.</p>}
                >
                    <For each={questions()}>
                        {(q,) => {
                            const value = answerFor(q.id,);
                            const blank = isEmpty(value,);
                            return (
                                <div class="submission-view__field">
                                    <div class="submission-view__label">{q.question}</div>
                                    <Show when={q.description}>
                                        <div class="submission-view__hint">{q.description}</div>
                                    </Show>

                                    <Show
                                        when={!blank}
                                        fallback={
                                            <div class="submission-view__value submission-view__value--blank">
                                                Not answered
                                            </div>
                                        }
                                    >
                                        {/* A multi-select reads as separate chips; joining them
                                            with commas hides where one answer ends. */}
                                        <Show when={Array.isArray(value,)}>
                                            <div class="submission-view__chips">
                                                <For each={value as string[]}>
                                                    {(v,) => <span class="submission-view__chip">{v}</span>}
                                                </For>
                                            </div>
                                        </Show>

                                        <Show when={!Array.isArray(value,) && q.type === 'textarea'}>
                                            {/* pre-wrap: a message's own line breaks are content. */}
                                            <div class="submission-view__value submission-view__value--long">
                                                {String(value,)}
                                            </div>
                                        </Show>

                                        <Show when={!Array.isArray(value,) && q.type === 'email'}>
                                            <div class="submission-view__value">
                                                <a href={`mailto:${String(value,)}`}>{String(value,)}</a>
                                            </div>
                                        </Show>

                                        <Show when={
                                            !Array.isArray(value,)
                                            && !['textarea', 'email',].includes(q.type,)
                                        }>
                                            <div class="submission-view__value">
                                                {q.type === 'checkbox' && typeof value === 'boolean'
                                                    ? (value ? 'Yes' : 'No')
                                                    : String(value,)}
                                            </div>
                                        </Show>
                                    </Show>
                                </div>
                            );
                        }}
                    </For>
                </Show>
            </div>

            <footer class="submission-view__foot">
                <Show when={props.onDelete && props.submission}>
                    <button
                        type="button"
                        class="ui-button ui-button--danger ui-button--sm"
                        onClick={() => props.onDelete!(props.submission!.id,)}
                    >
                        Delete
                    </button>
                </Show>
                <button
                    type="button"
                    class="ui-button ui-button--secondary ui-button--sm submission-view__close"
                    onClick={props.onClose}
                >
                    Close
                </button>
            </footer>
        </ModalShell>
    );
};

export default SubmissionViewModal;
