import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import { deriveFieldKeys, type Form, type FormActionType, type FormCreateBody, } from '@sitesurge/types';
import AutoSaveIndicator from '../../components/admin/common/AutoSaveIndicator';
import EditorSaveBar from '../../components/admin/common/EditorSaveBar';
import RichTextEditor from '../../components/admin/editors/RichTextEditor';
import Toggle from '../../components/admin/common/Toggle';
import { FormField, } from '../../components/admin/forms';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidateFormsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';

type QuestionKind = 'radio' | 'checkbox' | 'text' | 'textarea' | 'select' | 'number' | 'email' | 'date';

interface FormQuestion {
    id?: string;
    type: QuestionKind;
    question: string;
    description?: string;
    options: string[];
    isRequired: boolean;
    order: number;
}

const FormEditor: Component = () => {
    const params = useParams<{ id: string, }>();
    const navigate = useNavigate();
    const isNew = () => !params.id || params.id === 'new';
    const { markDirty, markClean, } = useUnsavedChanges();
    const { error, saving, beginSave, endSave, showError, setError, } = useEditorState();

    // Form metadata
    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [status, setStatus,] = createSignal('draft',);
    const [showResults, setShowResults,] = createSignal(false,);
    const [allowMultiple, setAllowMultiple,] = createSignal(false,);
    const [requiresAuth, setRequiresAuth,] = createSignal(false,);
    const [successMessage, setSuccessMessage,] = createSignal('',);
    const [maxSubmissions, setMaxSubmissions,] = createSignal('',);

    // On-submit action
    const [action, setAction,] = createSignal<FormActionType>('submit',);
    const [mailingListId, setMailingListId,] = createSignal('',);
    const [emailTo, setEmailTo,] = createSignal('',);
    const [emailSubject, setEmailSubject,] = createSignal('',);
    const [emailBody, setEmailBody,] = createSignal('',);
    const [showVars, setShowVars,] = createSignal(false,);

    // Questions
    const [questions, setQuestions,] = createSignal<FormQuestion[]>([],);

    // Mailing lists for the subscribe-action dropdown (loaded when needed).
    const [mailingLists,] = createResource(
        () => action() === 'subscribe' ? 'load' : null,
        async () => {
            try {
                const res = await cms.mailingLists.list() as unknown as
                    { data?: Array<{ id: string; name: string; }>; } | Array<{ id: string; name: string; }>;
                return Array.isArray(res,) ? res : (res.data ?? []);
            } catch {
                return [];
            }
        },
    );

    /** Variable tokens available in the email template, derived from the current
     *  questions (matches the backend's deriveFieldKeys). */
    const emailVars = createMemo(() => {
        const keys = deriveFieldKeys(
            questions().filter((q,) => q.id).map((q,) => ({ id: q.id!, question: q.question, })),
        );
        const perField = questions()
            .filter((q,) => q.id)
            .map((q,) => ({ token: keys[q.id!], label: q.question || '(untitled)', }));
        return [
            ...perField,
            { token: 'form_title', label: 'This form\'s title', },
            { token: 'submitted_at', label: 'Submission date/time', },
        ];
    },);

    // Load existing form
    const [form,] = createResource<Form | null, string>(
        () => !isNew() ? params.id : null,
        async (id,) => {
            let data: Form | null = null;
            try {
                data = await cms.forms.getById(id,);
            } catch {
                return null;
            }
            if (data) {
                setTitle(data.title || '',);
                setSlug(data.slug || '',);
                setDescription(data.description || '',);
                setStatus(data.status || 'draft',);
                setShowResults(data.showResults || false,);
                setAllowMultiple(data.allowMultipleSubmissions || false,);
                setRequiresAuth(data.requiresAuth || false,);
                setSuccessMessage(data.successMessage || '',);
                setMaxSubmissions(data.maxSubmissions != null ? String(data.maxSubmissions,) : '',);
                setAction((data.action as FormActionType) || 'submit',);
                const ac = data.actionConfig || {};
                setMailingListId(ac.mailingListId || '',);
                setEmailTo(ac.emailTo || '',);
                setEmailSubject(ac.emailSubject || '',);
                setEmailBody(ac.emailBody || '',);

                // Load questions
                if (data.questions && Array.isArray(data.questions,)) {
                    setQuestions(data.questions.map((q, index,) => ({
                        id: q.id,
                        type: (q.type || 'text') as QuestionKind,
                        question: q.question || '',
                        description: q.description || '',
                        options: q.options || [],
                        isRequired: q.isRequired || false,
                        order: q.order ?? index,
                    })),);
                }

                return data;
            }
            return null;
        },
    );

    const generateSlug = (text: string,) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-',)
            .replace(/(^-|-$)/g, '',);
    };

    const handleTitleChange = (e: Event,) => {
        const value = (e.target as HTMLInputElement).value;
        setTitle(value,);
        if (isNew()) {
            setSlug(generateSlug(value,),);
        }
        markDirty();
    };

    // Question management
    const addQuestion = () => {
        const newQuestion: FormQuestion = {
            type: 'text',
            question: '',
            description: '',
            options: [],
            isRequired: false,
            order: questions().length,
        };
        setQuestions([...questions(), newQuestion,],);
        markDirty();
    };

    const updateQuestion = (index: number, updates: Partial<FormQuestion>,) => {
        setQuestions(questions().map((q, i,) => i === index ? { ...q, ...updates, } : q),);
        markDirty();
    };

    const removeQuestion = (index: number,) => {
        if (confirm('Remove this question?',)) {
            setQuestions(questions().filter((_, i,) => i !== index),);
            markDirty();
        }
    };

    const moveQuestion = (index: number, direction: 'up' | 'down',) => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= questions().length) return;

        const newQuestions = [...questions(),];
        [newQuestions[index], newQuestions[newIndex],] = [newQuestions[newIndex], newQuestions[index],];
        setQuestions(newQuestions.map((q, i,) => ({ ...q, order: i, })),);
    };

    // Option management for poll questions
    const addOption = (questionIndex: number,) => {
        const q = questions()[questionIndex];
        updateQuestion(questionIndex, { options: [...q.options, '',], },);
    };

    const updateOption = (questionIndex: number, optionIndex: number, value: string,) => {
        const q = questions()[questionIndex];
        const newOptions = [...q.options,];
        newOptions[optionIndex] = value;
        updateQuestion(questionIndex, { options: newOptions, },);
    };

    const removeOption = (questionIndex: number, optionIndex: number,) => {
        const q = questions()[questionIndex];
        updateQuestion(questionIndex, {
            options: q.options.filter((_, i,) => i !== optionIndex),
        },);
    };

    // Auto-save draft to localStorage
    const autoSave = useAutoSave({
        key: `form-draft-${params.id || 'new'}`,
        state: () => ({
            title: title(),
            slug: slug(),
            description: description(),
            status: status(),
            showResults: showResults(),
            allowMultiple: allowMultiple(),
            requiresAuth: requiresAuth(),
            successMessage: successMessage(),
            maxSubmissions: maxSubmissions(),
            action: action(),
            mailingListId: mailingListId(),
            emailTo: emailTo(),
            emailSubject: emailSubject(),
            emailBody: emailBody(),
            questions: questions(),
        }),
    },);

    const handleSubmit = async (e?: Event,) => {
        e?.preventDefault();
        setError('',);

        // Validate
        if (!title().trim()) {
            setError('Title is required',);
            return;
        }

        if (questions().some(q => !q.question.trim())) {
            setError('All questions must have text',);
            return;
        }

        const pollTypes = ['radio', 'checkbox', 'select',];
        if (questions().some(q => pollTypes.includes(q.type,) && q.options.length < 2)) {
            setError('Poll questions must have at least 2 options',);
            return;
        }

        beginSave();

        try {
            const parsedMax = parseInt(maxSubmissions(), 10,);
            const payload: FormCreateBody = {
                title: title(),
                slug: slug(),
                description: description(),
                status: status() as FormCreateBody['status'],
                showResults: showResults(),
                allowMultipleSubmissions: allowMultiple(),
                requiresAuth: requiresAuth(),
                successMessage: successMessage(),
                maxSubmissions: Number.isFinite(parsedMax,) && parsedMax > 0 ? parsedMax : null,
                action: action(),
                actionConfig: {
                    mailingListId: mailingListId() || undefined,
                    emailTo: emailTo() || undefined,
                    emailSubject: emailSubject() || undefined,
                    emailBody: emailBody() || undefined,
                },
                questions: questions().map((q, index,) => ({
                    id: q.id,
                    type: q.type,
                    question: q.question,
                    description: q.description || null,
                    options: q.options.filter(o => o.trim()),
                    isRequired: q.isRequired,
                    order: index,
                })),
            };

            if (isNew()) {
                await cms.forms.create(payload,);
            } else {
                await cms.forms.update(params.id, payload,);
            }

            invalidateFormsCache();
            autoSave.clear();
            markClean();
            navigate('/admin/forms',);
        } catch (err) {
            showError(err, 'An error occurred while saving',);
        } finally {
            endSave();
        }
    };

    useKeyboardShortcuts([
        { key: 's', ctrl: true, handler: () => handleSubmit(), },
    ],);

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this form and all its submissions? This cannot be undone.',)) {
            return;
        }

        try {
            await cms.forms.remove(params.id,);
            invalidateFormsCache();
            navigate('/admin/forms',);
        } catch (err) {
            showError(err, 'An error occurred while deleting',);
        }
    };

    const questionTypeLabels: Record<string, string> = {
        text: 'Single Line Text',
        textarea: 'Long Text (Paragraph)',
        email: 'Email',
        number: 'Number',
        date: 'Date',
        radio: 'Multiple Choice (Single Answer)',
        checkbox: 'Checkboxes (Multiple Answers)',
        select: 'Dropdown',
    };

    const isPollType = (type: string,) => ['radio', 'checkbox', 'select',].includes(type,);

    return (
        <div class="admin-editor form-editor">
            <Title>{isNew() ? 'New Form' : 'Edit Form'} - Admin - RW</Title>

            <div class="admin-header">
                <h1>{isNew() ? 'New Form' : 'Edit Form'}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                    <Show when={!isNew() && (form()?.submissionCount ?? 0) > 0}>
                        <A href={`/admin/forms/${params.id}/submissions`} class="btn btn--secondary btn--small">
                            View Responses ({form()?.submissionCount})
                        </A>
                    </Show>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={isNew() || form()} fallback={<div>Loading...</div>}>
                <form onSubmit={handleSubmit} class="admin-form">
                    {/* Form Metadata Section */}
                    <section class="form-section">
                        <h2>Form Details</h2>

                        <FormField label="Title *">
                            <input
                                type="text"
                                value={title()}
                                onInput={handleTitleChange}
                                required
                                placeholder="Form title"
                            />
                        </FormField>

                        <FormField label="URL Slug *" hint={`Used in the URL: /forms/${slug() || 'slug'}`}>
                            <input
                                type="text"
                                value={slug()}
                                onInput={(e,) => {
                                    setSlug((e.target as HTMLInputElement).value,);
                                    markDirty();
                                }}
                                required
                                placeholder="form-url-slug"
                            />
                        </FormField>

                        <FormField label="Description">
                            <textarea
                                value={description()}
                                onInput={(e,) => {
                                    setDescription((e.target as HTMLTextAreaElement).value,);
                                    markDirty();
                                }}
                                placeholder="Instructions or description for respondents..."
                                rows={3}
                            />
                        </FormField>

                        <FormField label="Success Message">
                            <input
                                type="text"
                                value={successMessage()}
                                onInput={(e,) => {
                                    setSuccessMessage((e.target as HTMLInputElement).value,);
                                    markDirty();
                                }}
                                placeholder="Thank you for your submission!"
                            />
                        </FormField>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="status">Status</label>
                                <select
                                    id="status"
                                    value={status()}
                                    onChange={(e,) => {
                                        setStatus((e.target as HTMLSelectElement).value,);
                                        markDirty();
                                    }}
                                >
                                    <option value="draft">Draft</option>
                                    <option value="published">Published</option>
                                    <option value="closed">Closed</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <Toggle
                                checked={showResults()}
                                onChange={(next,) => { setShowResults(next,); markDirty(); }}
                                label="Show results to respondents after submission"
                            />
                        </div>

                        <div class="form-group">
                            <Toggle
                                checked={allowMultiple()}
                                onChange={(next,) => { setAllowMultiple(next,); markDirty(); }}
                                label="Allow multiple submissions per user"
                            />
                        </div>

                        <div class="form-group">
                            <Toggle
                                checked={requiresAuth()}
                                onChange={(next,) => { setRequiresAuth(next,); markDirty(); }}
                                label="Require sign-in to submit"
                            />
                        </div>

                        <FormField
                            label="Max submissions"
                            tooltip="Stop accepting submissions after this many. Leave blank for unlimited. (An accidental double-submit from the same page load is always de-duplicated automatically.)"
                        >
                            <input
                                type="number"
                                min="0"
                                value={maxSubmissions()}
                                onInput={(e,) => { setMaxSubmissions(e.currentTarget.value,); markDirty(); }}
                                placeholder="Unlimited"
                                style={{ 'max-width': '200px', }}
                            />
                        </FormField>
                    </section>

                    {/* On-submit action */}
                    <section class="form-section">
                        <h2>On Submit</h2>
                        <FormField
                            label="Action"
                            tooltip="What happens when someone submits this form. Every submission is always saved so you can view responses; Subscribe and Email run in addition to saving."
                        >
                            <select
                                value={action()}
                                onChange={(e,) => { setAction(e.currentTarget.value as FormActionType,); markDirty(); }}
                                style={{ 'max-width': '320px', }}
                            >
                                <option value="submit">Save submission (default)</option>
                                <option value="subscribe">Subscribe to a mailing list</option>
                                <option value="email">Send an email</option>
                            </select>
                        </FormField>

                        {/* Subscribe settings */}
                        <Show when={action() === 'subscribe'}>
                            <div class="form-subaction">
                                <FormField label="Mailing list">
                                    <select
                                        value={mailingListId()}
                                        onChange={(e,) => { setMailingListId(e.currentTarget.value,); markDirty(); }}
                                        style={{ 'max-width': '320px', }}
                                    >
                                        <option value="">— Select a list —</option>
                                        <For each={mailingLists() || []}>
                                            {(l,) => <option value={l.id}>{l.name}</option>}
                                        </For>
                                    </select>
                                    <Show when={(mailingLists() || []).length === 0}>
                                        <small class="form-help">
                                            No mailing lists found. Create one under{' '}
                                            <A href="/admin/mailing-lists">Mailing Lists</A> (requires the Mailing
                                            Lists feature).
                                        </small>
                                    </Show>
                                    <small class="form-help">
                                        The submitter is added to this list using their <strong>Email</strong> field
                                        (add an Email question below). The list's double opt-in setting is respected.
                                    </small>
                                </FormField>
                            </div>
                        </Show>

                        {/* Email settings */}
                        <Show when={action() === 'email'}>
                            <div class="form-subaction">
                                <FormField label="Send to">
                                    <input
                                        type="text"
                                        value={emailTo()}
                                        onInput={(e,) => { setEmailTo(e.currentTarget.value,); markDirty(); }}
                                        placeholder="admin@example.com  (or a variable like {{email}})"
                                    />
                                </FormField>
                                <FormField label="Subject">
                                    <input
                                        type="text"
                                        value={emailSubject()}
                                        onInput={(e,) => { setEmailSubject(e.currentTarget.value,); markDirty(); }}
                                        placeholder="New submission for {{form_title}}"
                                    />
                                </FormField>
                                <FormField label="Email body">
                                    <RichTextEditor
                                        value={emailBody()}
                                        onChange={(html,) => { setEmailBody(html,); markDirty(); }}
                                        placeholder="Compose the email. Insert form values with {{ variables }} — see the reference below."
                                    />
                                </FormField>

                                {/* Variables help */}
                                <div class="form-vars">
                                    <button
                                        type="button"
                                        class="form-vars__toggle"
                                        onClick={() => setShowVars(!showVars(),)}
                                        aria-expanded={showVars()}
                                    >
                                        <span class="form-vars__chev">{showVars() ? '▾' : '▸'}</span>
                                        Available variables
                                    </button>
                                    <Show when={showVars()}>
                                        <div class="form-vars__body">
                                            <p class="form-help">
                                                Use these in the Send&nbsp;to, Subject, and Body. They're replaced with
                                                the submitted values when the form is sent.
                                            </p>
                                            <ul class="form-vars__list">
                                                <For each={emailVars()}>
                                                    {(v,) => (
                                                        <li>
                                                            <code>{`{{${v.token}}}`}</code>
                                                            <span class="form-vars__label">{v.label}</span>
                                                        </li>
                                                    )}
                                                </For>
                                            </ul>
                                            <Show when={emailVars().length <= 2}>
                                                <small class="form-help">
                                                    Add questions below to get more variables (save the form to
                                                    finalize their names).
                                                </small>
                                            </Show>
                                            <p class="form-help" style={{ 'margin-top': '8px', }}>
                                                You can also run values through functions, e.g.{' '}
                                                <code>{'{{upper(email)}}'}</code>,{' '}
                                                <code>{'{{formatDate(submitted_at)}}'}</code>, or{' '}
                                                <code>{'{{default(name, \'there\')}}'}</code>.
                                            </p>
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </Show>
                    </section>

                    {/* Questions Section */}
                    <section class="form-section">
                        <div class="section-header">
                            <h2>Questions</h2>
                            <button type="button" class="btn btn--secondary" onClick={addQuestion}>
                                Add Question
                            </button>
                        </div>

                        <Show when={questions().length === 0}>
                            <div class="empty-state">
                                <p>No questions yet. Click "Add Question" to get started.</p>
                            </div>
                        </Show>

                        <div class="questions-list">
                            <For each={questions()}>
                                {(question, index,) => (
                                    <div class="question-card">
                                        <div class="question-header">
                                            <span class="question-number">Question {index() + 1}</span>
                                            <div class="question-actions">
                                                <button
                                                    type="button"
                                                    class="btn btn--icon"
                                                    onClick={() => moveQuestion(index(), 'up',)}
                                                    disabled={index() === 0}
                                                    title="Move up"
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn btn--icon"
                                                    onClick={() => moveQuestion(index(), 'down',)}
                                                    disabled={index() === questions().length - 1}
                                                    title="Move down"
                                                >
                                                    ↓
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn btn--icon btn--danger"
                                                    onClick={() => removeQuestion(index(),)}
                                                    title="Remove"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>

                                        <div class="question-body">
                                            <div class="form-row">
                                                <div class="form-group form-group--grow">
                                                    <label>Question Text *</label>
                                                    <input
                                                        type="text"
                                                        value={question.question}
                                                        onInput={(e,) =>
                                                            updateQuestion(index(), {
                                                                question: (e.target as HTMLInputElement).value,
                                                            },)}
                                                        placeholder="Enter your question..."
                                                    />
                                                </div>

                                                <div class="form-group">
                                                    <label>Type</label>
                                                    <select
                                                        value={question.type}
                                                        onChange={(e,) =>
                                                            updateQuestion(index(), {
                                                                type: (e.target as HTMLSelectElement)
                                                                    .value as FormQuestion['type'],
                                                                options: isPollType(
                                                                        (e.target as HTMLSelectElement).value,
                                                                    ) && question.options.length === 0 ?
                                                                    ['', '',] :
                                                                    question.options,
                                                            },)}
                                                    >
                                                        <option value="text">{questionTypeLabels.text}</option>
                                                        <option value="textarea">{questionTypeLabels.textarea}</option>
                                                        <option value="email">{questionTypeLabels.email}</option>
                                                        <option value="number">{questionTypeLabels.number}</option>
                                                        <option value="date">{questionTypeLabels.date}</option>
                                                        <option value="radio">{questionTypeLabels.radio}</option>
                                                        <option value="checkbox">{questionTypeLabels.checkbox}</option>
                                                        <option value="select">{questionTypeLabels.select}</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div class="form-group">
                                                <label>Help Text (Optional)</label>
                                                <input
                                                    type="text"
                                                    value={question.description || ''}
                                                    onInput={(e,) =>
                                                        updateQuestion(index(), {
                                                            description: (e.target as HTMLInputElement).value,
                                                        },)}
                                                    placeholder="Additional instructions for this question..."
                                                />
                                            </div>

                                            {/* Options for poll-type questions */}
                                            <Show when={isPollType(question.type,)}>
                                                <div class="options-section">
                                                    <label>Answer Options</label>
                                                    <div class="options-list">
                                                        <For each={question.options}>
                                                            {(option, optIndex,) => (
                                                                <div class="option-row">
                                                                    <span class="option-indicator">
                                                                        {question.type === 'checkbox' ? '☐' : '○'}
                                                                    </span>
                                                                    <input
                                                                        type="text"
                                                                        value={option}
                                                                        onInput={(e,) =>
                                                                            updateOption(
                                                                                index(),
                                                                                optIndex(),
                                                                                (e.target as HTMLInputElement).value,
                                                                            )}
                                                                        placeholder={`Option ${optIndex() + 1}`}
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        class="btn btn--icon btn--small"
                                                                        onClick={() =>
                                                                            removeOption(index(), optIndex(),)}
                                                                        disabled={question.options.length <= 2}
                                                                        title="Remove option"
                                                                    >
                                                                        ×
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </For>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        class="btn btn--small btn--secondary"
                                                        onClick={() => addOption(index(),)}
                                                    >
                                                        Add Option
                                                    </button>
                                                </div>
                                            </Show>

                                            <div class="form-group">
                                                <Toggle
                                                    checked={question.isRequired}
                                                    onChange={(next,) =>
                                                        updateQuestion(index(), { isRequired: next, },)}
                                                    label="Required"
                                                    size="sm"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>

                        <Show when={questions().length > 0}>
                            <button type="button" class="btn btn--secondary" onClick={addQuestion}>
                                Add Another Question
                            </button>
                        </Show>
                    </section>

                    <EditorSaveBar
                        onSave={() => handleSubmit()}
                        onCancel={() => navigate('/admin/forms',)}
                        onDelete={handleDelete}
                        saving={saving()}
                        showDelete={!isNew()}
                        saveLabel="Save Form"
                        deleteLabel="Delete Form"
                    />
                </form>
            </Show>
        </div>
    );
};

export default FormEditor;
