import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/AutoSaveIndicator';
import EditorSaveBar from '../../components/admin/EditorSaveBar';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidateFormsCache, } from '../../services/adminData';
import { api, } from '../../services/api';

interface FormQuestion {
    id?: string;
    type: 'radio' | 'checkbox' | 'text' | 'textarea' | 'select';
    question: string;
    description?: string;
    options: string[];
    isRequired: boolean;
    order: number;
}

const FormEditor: Component = () => {
    const params = useParams();
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
    const [successMessage, setSuccessMessage,] = createSignal('',);

    // Questions
    const [questions, setQuestions,] = createSignal<FormQuestion[]>([],);

    // Load existing form
    const [form,] = createResource(
        () => !isNew() ? params.id : null,
        async (id,) => {
            const response = await api.get(`/forms/${id}`,);
            if (response.success && response.data) {
                const data = response.data as any;
                setTitle(data.title || '',);
                setSlug(data.slug || '',);
                setDescription(data.description || '',);
                setStatus(data.status || 'draft',);
                setShowResults(data.showResults || false,);
                setAllowMultiple(data.allowMultipleSubmissions || false,);
                setSuccessMessage(data.successMessage || '',);

                // Load questions
                if (data.questions && Array.isArray(data.questions,)) {
                    setQuestions(data.questions.map((q: any, index: number,) => ({
                        id: q.id,
                        type: q.type || 'text',
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
            successMessage: successMessage(),
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
            const payload = {
                title: title(),
                slug: slug(),
                description: description(),
                status: status(),
                showResults: showResults(),
                allowMultipleSubmissions: allowMultiple(),
                successMessage: successMessage(),
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

            let response;
            if (isNew()) {
                response = await api.post('/forms', payload,);
            } else {
                response = await api.put(`/forms/${params.id}`, payload,);
            }

            if (response.success) {
                invalidateFormsCache();
                autoSave.clear();
                markClean();
                navigate('/admin/forms',);
            } else {
                showError(response, 'Failed to save form',);
            }
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
            const response = await api.delete(`/forms/${params.id}`,);
            if (response.success) {
                invalidateFormsCache();
                navigate('/admin/forms',);
            } else {
                showError(response, 'Failed to delete form',);
            }
        } catch (err) {
            showError(err, 'An error occurred while deleting',);
        }
    };

    const questionTypeLabels: Record<string, string> = {
        text: 'Single Line Text',
        textarea: 'Long Text (Paragraph)',
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
                    <Show when={!isNew() && form() && (form() as any).submissionCount > 0}>
                        <A href={`/admin/forms/${params.id}/submissions`} class="btn btn--secondary btn--small">
                            View Responses ({(form() as any).submissionCount})
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

                        <div class="form-group">
                            <label for="title">Title *</label>
                            <input
                                type="text"
                                id="title"
                                value={title()}
                                onInput={handleTitleChange}
                                required
                                placeholder="Form title"
                            />
                        </div>

                        <div class="form-group">
                            <label for="slug">URL Slug *</label>
                            <input
                                type="text"
                                id="slug"
                                value={slug()}
                                onInput={(e,) => {
                                    setSlug((e.target as HTMLInputElement).value,);
                                    markDirty();
                                }}
                                required
                                placeholder="form-url-slug"
                            />
                            <small class="form-help">Used in the URL: /forms/{slug() || 'slug'}</small>
                        </div>

                        <div class="form-group">
                            <label for="description">Description</label>
                            <textarea
                                id="description"
                                value={description()}
                                onInput={(e,) => {
                                    setDescription((e.target as HTMLTextAreaElement).value,);
                                    markDirty();
                                }}
                                placeholder="Instructions or description for respondents..."
                                rows={3}
                            />
                        </div>

                        <div class="form-group">
                            <label for="successMessage">Success Message</label>
                            <input
                                type="text"
                                id="successMessage"
                                value={successMessage()}
                                onInput={(e,) => {
                                    setSuccessMessage((e.target as HTMLInputElement).value,);
                                    markDirty();
                                }}
                                placeholder="Thank you for your submission!"
                            />
                        </div>

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
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={showResults()}
                                    onChange={(e,) => {
                                        setShowResults((e.target as HTMLInputElement).checked,);
                                        markDirty();
                                    }}
                                />
                                <span>Show results to respondents after submission</span>
                            </label>
                        </div>

                        <div class="form-group">
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={allowMultiple()}
                                    onChange={(e,) => {
                                        setAllowMultiple((e.target as HTMLInputElement).checked,);
                                        markDirty();
                                    }}
                                />
                                <span>Allow multiple submissions per user</span>
                            </label>
                        </div>
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
                                                <label class="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={question.isRequired}
                                                        onChange={(e,) =>
                                                            updateQuestion(index(), {
                                                                isRequired: (e.target as HTMLInputElement).checked,
                                                            },)}
                                                    />
                                                    <span>Required</span>
                                                </label>
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
