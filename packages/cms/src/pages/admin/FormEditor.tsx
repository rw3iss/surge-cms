import {
    deriveFieldKeys,
    dropFormRow,
    dropFormRowAtEnd,
    type Form,
    formLayoutFromRows,
    formRowsFromLayout,
    type FormSectionRow,
    isFormSectionRow,
    moveFormRow,
    normalizeFormRows,
    removeFormSection,
    type FormActionType,
    type FormCreateBody,
    parseEmailList,
} from '@sitesurge/types';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/common/AutoSaveIndicator';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import EditorSaveBar from '../../components/admin/common/EditorSaveBar';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import RichTextEditor from '../../components/admin/editors/RichTextEditor';
import { CommitInput, FormField, } from '../../components/admin/forms';
import AlignButtons from '../../components/admin/common/AlignButtons';
import ModalShell from '../../components/admin/common/ModalShell';
import FormPreviewModal from '../../components/admin/forms/FormPreviewModal';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidateFormsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import AdminTitle from '../../components/admin/common/AdminTitle';
import { useToast, } from '../../components/common/toast';

type QuestionKind = 'radio' | 'checkbox' | 'text' | 'textarea' | 'select' | 'number' | 'email' | 'date';

interface FormQuestion {
    id?: string;
    /** Client-only key for an unsaved question (collapse state); never sent. */
    uiKey?: string;
    /** The section it is in (`FormSectionRow.id`); null = the root. */
    sectionId?: string | null;
    type: QuestionKind;
    question: string;
    description?: string;
    options: string[];
    isRequired: boolean;
    order: number;
    width?: 'full' | 'half';
    placeholder?: string;
    questionAsPlaceholder?: boolean;
    rows?: number;
    allowResize?: boolean;
    maxHeight?: string;
}

/** Free-text inputs that support a placeholder (and, for textarea, sizing). */
const isTextInputType = (t: string,): boolean => t === 'text' || t === 'textarea' || t === 'email' || t === 'number';

const FormEditor: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const isNew = () => !params.id || params.id === 'new';
    const { markDirty, markClean, ...leaveGuard } = useUnsavedChanges();
    const toast = useToast();
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
    const [submitButtonText, setSubmitButtonText,] = createSignal('',);
    const [maxSubmissions, setMaxSubmissions,] = createSignal('',);

    // On-submit action
    const [action, setAction,] = createSignal<FormActionType>('submit',);
    const [mailingListId, setMailingListId,] = createSignal('',);
    const [emailTo, setEmailTo,] = createSignal('',);
    const [emailToError, setEmailToError,] = createSignal('',);
    const [emailSubject, setEmailSubject,] = createSignal('',);
    const [emailBody, setEmailBody,] = createSignal('',);
    // subscribe/email: also store the submission (default off).
    const [saveSubmission, setSaveSubmission,] = createSignal(false,);
    const [addContact, setAddContact,] = createSignal(false,);
    const contactsEnabled = () => isFeatureEnabled('contacts',);
    const [showVars, setShowVars,] = createSignal(false,);

    // Questions + sections, as ONE flat list in display order: a section row
    // is followed by its questions (`utils/formSections` keeps it that way).
    const [rows, setRows,] = createSignal<Array<FormQuestion | FormSectionRow>>([],);
    const questions = createMemo(() => rows().filter((r,): r is FormQuestion => !isFormSectionRow(r,),),);
    /** Root-level rows (sections and questions not in a section) — same objects, so unchanged cards keep their DOM. */
    const rootRows = createMemo(() => rows().filter((r,) => isFormSectionRow(r,) || !r.sectionId,),);
    const childrenOf = (sectionId: string,) => questions().filter((q,) => q.sectionId === sectionId,);

    /** Questions + sections from a saved form → the editor rows (also after each save: new questions get their ids). */
    const loadRows = (data: Pick<Form, 'questions' | 'sections'>,) => {
        if (!Array.isArray(data.questions,)) return;
        setRows(formRowsFromLayout(data.questions.slice().sort((a, b,) => (a.order ?? 0) - (b.order ?? 0)).map((q, index,): FormQuestion => ({
                id: q.id,
                sectionId: q.sectionId ?? null,
                type: (q.type || 'text') as QuestionKind,
                question: q.question || '',
                description: q.description || '',
                options: q.options || [],
                isRequired: q.isRequired || false,
                order: q.order ?? index,
                width: q.width || 'full',
                placeholder: q.placeholder || '',
                questionAsPlaceholder: q.questionAsPlaceholder ?? false,
                rows: q.rows ?? 4,
                allowResize: q.allowResize ?? true,
                maxHeight: q.maxHeight || '',
            })), data.sections,),);
    };

    // Mailing lists for the subscribe-action dropdown (loaded when needed).
    const [mailingLists,] = createResource(
        () => action() === 'subscribe' ? 'load' : null,
        async () => {
            try {
                const res = await cms.mailingLists.list() as unknown as
                    | { data?: Array<{ id: string; name: string; }>; }
                    | Array<{ id: string; name: string; }>;
                return Array.isArray(res,) ? res : (res.data ?? []);
            } catch {
                return [];
            }
        },
    );

    // Re-apply the saved mailing list once the async options have rendered.
    // SolidJS won't re-run the `value` binding when only the option list
    // changes, so a value set (on load) before its <option> exists is dropped
    // by the DOM — leaving the dropdown blank after a refresh. This effect
    // forces the selection when both the id and the loaded lists are present.
    let mailingListSelect: HTMLSelectElement | undefined;
    createEffect(() => {
        const id = mailingListId();
        const lists = mailingLists();
        if (mailingListSelect && lists && lists.length) mailingListSelect.value = id;
    },);

    /**
     * Validate the comma-separated "Send to" list on blur (not while typing —
     * a half-typed address is not an error yet).
     *
     * Entries containing `{{ }}` are skipped: the field accepts template tokens
     * like `{{email}}` that only resolve to an address at send time, so they
     * cannot be checked here. Everything else must be a literal address, and the
     * split/trim/validate is the SAME shared helper the backend sends with.
     */
    const validateEmailTo = (): boolean => {
        const raw = emailTo().trim();
        if (!raw) {
            setEmailToError('',); // empty is allowed; the action just won't send
            return true;
        }
        const literals = raw
            .split(/[,;]/,)
            .map((p,) => p.trim())
            .filter((p,) => p && !p.includes('{{',));
        const { invalid, } = parseEmailList(literals.join(',',),);
        if (invalid.length) {
            setEmailToError(
                invalid.length === 1 ?
                    `"${invalid[0]}" is not a valid email address.` :
                    `Not valid email addresses: ${invalid.map((e,) => `"${e}"`).join(', ',)}.`,
            );
            return false;
        }
        setEmailToError('',);
        return true;
    };

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
            { token: 'form_title', label: "This form's title", },
            { token: 'submitted_at', label: 'Submission date/time', },
            { token: 'answersHtml', label: 'Every answer, laid out like the form (sections, field widths)', },
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
                setSubmitButtonText(data.submitButtonText || '',);
                setMaxSubmissions(data.maxSubmissions != null ? String(data.maxSubmissions,) : '',);
                setAction((data.action as FormActionType) || 'submit',);
                const ac = data.actionConfig || {};
                setMailingListId(ac.mailingListId || '',);
                setEmailTo(ac.emailTo || '',);
                setEmailSubject(ac.emailSubject || '',);
                setEmailBody(ac.emailBody || '',);
                setSaveSubmission(ac.saveSubmission ?? false,);
                setAddContact(ac.addContact ?? false,);

                // Load questions + sections
                loadRows(data,);

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
    const addQuestion = (sectionId?: string,) => {
        const newQuestion: FormQuestion = {
            uiKey: crypto.randomUUID(),
            sectionId: sectionId ?? null,
            type: 'text',
            question: '',
            description: '',
            options: [],
            isRequired: false,
            order: questions().length,
            width: 'full',
            placeholder: '',
            questionAsPlaceholder: false,
            rows: 4,
            allowResize: true,
            maxHeight: '',
        };
        // At the end of its section (normalize moves it there), else the end of the form.
        setRows(normalizeFormRows([...rows(), newQuestion,],),);
        if (sectionId && collapsed().has(sectionId,)) {
            const next = new Set(collapsed(),);
            next.delete(sectionId,);
            setCollapsed(next,);
        }
        markDirty();
    };

    const addSection = () => {
        setRows([...rows(), { kind: 'section', id: crypto.randomUUID(), title: '', description: '', align: 'left', },],);
        markDirty();
    };
    const updateSection = (id: string, patch: Partial<Omit<FormSectionRow, 'kind' | 'id'>>,) => {
        setRows(rows().map((r,) => isFormSectionRow(r,) && r.id === id ? { ...r, ...patch, } : r),);
        markDirty();
    };
    /** Delete-section modal: the section being deleted (null = closed). */
    const [sectionToDelete, setSectionToDelete,] = createSignal<FormSectionRow | null>(null,);
    const deleteSection = (mode: 'delete' | 'keep',) => {
        const sec = sectionToDelete();
        if (!sec) return;
        setRows(removeFormSection(rows(), sec.id, mode,),);
        setSectionToDelete(null,);
        markDirty();
    };

    const updateQuestion = (index: number, updates: Partial<FormQuestion>,) => {
        const target = questions()[index];
        setRows(rows().map((r,) => r === target ? { ...target, ...updates, } : r),);
        markDirty();
    };

    const removeQuestion = (index: number,) => {
        if (confirm('Remove this question?',)) {
            const target = questions()[index];
            setRows(rows().filter((r,) => r !== target,),);
            markDirty();
        }
    };

    // Preview: the editor's CURRENT state as a Form, rendered by the public FormRenderer.
    const [previewOpen, setPreviewOpen,] = createSignal(false,);
    const previewForm = (): Form => ({
        id: params.id ?? 'preview',
        title: title() || 'Untitled form',
        slug: slug() || 'preview',
        description: description() || undefined,
        status: status() as Form['status'],
        showResults: false,
        allowMultipleSubmissions: true,
        requiresAuth: false,
        successMessage: successMessage() || undefined,
        submitButtonText: submitButtonText() || undefined,
        action: action(),
        sections: formLayoutFromRows(rows(),).sections,
        questions: formLayoutFromRows(rows(),).questions.map((q, i,) => ({
            ...q,
            id: q.id ?? q.uiKey ?? `preview-${i}`,
            formId: params.id ?? 'preview',
            options: q.options.filter((o,) => o.trim(),),
            order: i,
            createdAt: new Date(),
            updatedAt: new Date(),
        }),) as Form['questions'],
        submissionCount: 0,
        createdBy: '',
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    // Collapsed question cards, by a stable key (the saved id, else a client key
    // given on add / load) — survives reordering and edits.
    const [collapsed, setCollapsed,] = createSignal<Set<string>>(new Set(),);
    const keyOf = (q: FormQuestion, i: number,): string => q.id ?? q.uiKey ?? `i${i}`;
    const isCollapsed = (q: FormQuestion, i: number,): boolean => collapsed().has(keyOf(q, i,),);
    const toggleCollapsed = (q: FormQuestion, i: number,) => {
        const next = new Set(collapsed(),);
        const k = keyOf(q, i,);
        if (next.has(k,)) next.delete(k,); else next.add(k,);
        setCollapsed(next,);
    };
    const [submitOpen, setSubmitOpen,] = createSignal(true,);
    const [detailsOpen, setDetailsOpen,] = createSignal(true,);
    /** Collapse / expand every section and question card. */
    const collapseAll = () => setCollapsed(new Set([
        ...questions().map((q, i,) => keyOf(q, i,),),
        ...rows().filter(isFormSectionRow,).map((r,) => r.id,),
    ],),);
    const expandAll = () => setCollapsed(new Set<string>(),);

    /** ↑ / ↓ on a row: among its siblings (inside its section, or the root units). */
    const moveRow = (rowIndex: number, direction: 'up' | 'down',) => {
        const next = moveFormRow(rows(), rowIndex, direction,);
        if (next === rows()) return;
        setRows(next,);
        markDirty();
    };
    const canMove = (rowIndex: number, direction: 'up' | 'down',): boolean => moveFormRow(rows(), rowIndex, direction,) !== rows();
    const moveQuestion = (index: number, direction: 'up' | 'down',) => moveRow(rows().indexOf(questions()[index]!,), direction,);

    // Drag to sort (questions AND sections): a card is dragged by its header;
    // the drop lands before / after the card under the pointer. A question
    // joins its target's section; on a section, the top half of its HEADER
    // means "above the section" and anything below means "into it" (at the top).
    const [dragFrom, setDragFrom,] = createSignal<number | null>(null,);
    const [dropAt, setDropAt,] = createSignal<{ index: number; after: boolean; } | null>(null,);
    const [endOver, setEndOver,] = createSignal(false,);
    const onCardDragOver = (e: DragEvent, index: number, rectOf?: HTMLElement | null,) => {
        if (dragFrom() === null) return;
        e.preventDefault();
        e.stopPropagation(); // a question inside a section must not also reach the section card
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const r = (rectOf ?? e.currentTarget as HTMLElement).getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        const cur = dropAt();
        if (!cur || cur.index !== index || cur.after !== after) setDropAt({ index, after, },);
        if (endOver()) setEndOver(false,);
    };
    const onCardDrop = (e: DragEvent,) => {
        e.preventDefault();
        e.stopPropagation();
        const from = dragFrom();
        const at = dropAt();
        if (from !== null && at) {
            const next = dropFormRow(rows(), from, at.index, at.after,);
            if (next !== rows()) { setRows(next,); markDirty(); }
        }
        setDragFrom(null,);
        setDropAt(null,);
        setEndOver(false,);
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
            submitButtonText: submitButtonText(),
            maxSubmissions: maxSubmissions(),
            action: action(),
            mailingListId: mailingListId(),
            emailTo: emailTo(),
            emailSubject: emailSubject(),
            emailBody: emailBody(),
            saveSubmission: saveSubmission(),
            addContact: addContact(),
            rows: rows(),
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

        // Re-check on save as well as on blur: a bad address could otherwise be
        // saved by hitting Save straight from the field, and the send would then
        // drop that recipient silently.
        if (action() === 'email' && !validateEmailTo()) {
            setError('Please correct the "Send to" address list.',);
            return;
        }

        beginSave();

        try {
            const parsedMax = parseInt(maxSubmissions(), 10,);
            // Questions in display order (their index = overall order) + sections with positions.
            const layout = formLayoutFromRows(rows(),);
            const payload: FormCreateBody = {
                title: title(),
                slug: slug(),
                description: description(),
                status: status() as FormCreateBody['status'],
                showResults: showResults(),
                allowMultipleSubmissions: allowMultiple(),
                requiresAuth: requiresAuth(),
                successMessage: successMessage(),
                submitButtonText: submitButtonText().trim() || undefined,
                maxSubmissions: Number.isFinite(parsedMax,) && parsedMax > 0 ? parsedMax : null,
                action: action(),
                actionConfig: {
                    mailingListId: mailingListId() || undefined,
                    emailTo: emailTo() || undefined,
                    emailSubject: emailSubject() || undefined,
                    emailBody: emailBody() || undefined,
                    // Only meaningful for subscribe/email; submit always saves.
                    saveSubmission: (action() === 'subscribe' || action() === 'email') ?
                        saveSubmission() :
                        undefined,
                    // Applies to EVERY action, including plain submit.
                    addContact: addContact(),
                },
                sections: layout.sections,
                questions: layout.questions.map((q, index,) => ({
                    id: q.id,
                    sectionId: q.sectionId ?? null,
                    type: q.type,
                    question: q.question,
                    description: q.description || null,
                    options: q.options.filter(o => o.trim()),
                    isRequired: q.isRequired,
                    order: index,
                    width: q.width || 'full',
                    questionAsPlaceholder: isTextInputType(q.type,) ? (q.questionAsPlaceholder ?? false) : undefined,
                    placeholder: isTextInputType(q.type,) && !q.questionAsPlaceholder ?
                        (q.placeholder || undefined) :
                        undefined,
                    rows: q.type === 'textarea' ? (q.rows ?? 4) : undefined,
                    allowResize: q.type === 'textarea' ? (q.allowResize ?? true) : undefined,
                    maxHeight: q.type === 'textarea' && q.allowResize ? (q.maxHeight || undefined) : undefined,
                })),
            };

            // Stay on the page: a new form moves to its edit URL; an existing one
            // reloads its questions from the response so new questions carry
            // their ids (a second save must update them, not add them again).
            const saved = isNew() ? await cms.forms.create(payload,) : await cms.forms.update(params.id, payload,);
            invalidateFormsCache();
            autoSave.clear();
            markClean();
            toast.success(isNew() ? 'Form created' : 'Form saved',);
            if (isNew()) {
                navigate(`/admin/forms/${(saved as Form).id}`, { replace: true, },);
            } else {
                loadRows(saved as Form,);
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

    /** One question card (root or inside a section). `index` = its number among all questions; `rowIndex` = its place in the flat rows (drag + move). */
    const questionCard = (question: FormQuestion,) => {
        const index = () => questions().indexOf(question,);
        const rowIndex = () => rows().indexOf(question,);
        return (
            <div
                class="question-card"
                classList={{
                    'is-collapsed': isCollapsed(question, index(),),
                    'is-dragging': dragFrom() === rowIndex(),
                    'is-drop-before': dropAt()?.index === rowIndex() && !dropAt()!.after && dragFrom() !== rowIndex(),
                    'is-drop-after': dropAt()?.index === rowIndex() && dropAt()!.after && dragFrom() !== rowIndex(),
                    'question-card--in-section': !!question.sectionId,
                }}
                onDragOver={(e,) => onCardDragOver(e, rowIndex(),)}
                onDrop={onCardDrop}
            >
                {/* Clicking the header (not its ↑ ↓ × buttons) collapses / expands the card;
                    dragging it sorts the card. */}
                <div
                    class="question-header"
                    draggable={true}
                    title="Drag to reorder · click to collapse"
                    onDragStart={(e,) => {
                        if ((e.target as HTMLElement).closest?.('button, a, input, select, textarea',)) { e.preventDefault(); return; }
                        setDragFrom(rowIndex(),);
                        if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(rowIndex(),),);
                            // The whole card as the drag image, not just the header.
                            const card = (e.currentTarget as HTMLElement).closest('.question-card',) as HTMLElement | null;
                            if (card) e.dataTransfer.setDragImage(card, 24, 16,);
                        }
                    }}
                    onDragEnd={() => { setDragFrom(null,); setDropAt(null,); setEndOver(false,); }}
                    onClick={(e,) => {
                        if ((e.target as HTMLElement).closest('button, a, input, select, textarea',)) return;
                        toggleCollapsed(question, index(),);
                    }}
                >
                    <span class="question-number">
                        <button
                            type="button"
                            class="collapse-arrow"
                            classList={{ 'is-open': !isCollapsed(question, index(),), }}
                            aria-expanded={!isCollapsed(question, index(),)}
                            aria-label={isCollapsed(question, index(),) ? `Expand question ${index() + 1}` : `Collapse question ${index() + 1}`}
                            onClick={() => toggleCollapsed(question, index(),)}
                        />
                        Question {index() + 1}
                        <Show when={isCollapsed(question, index(),) && question.question}>
                            <span class="question-summary">— {question.question}</span>
                        </Show>
                    </span>
                    <div class="question-actions">
                        <button
                            type="button"
                            class="btn btn--icon"
                            onClick={() => moveQuestion(index(), 'up',)}
                            disabled={!canMove(rowIndex(), 'up',)}
                            title="Move up"
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            class="btn btn--icon"
                            onClick={() => moveQuestion(index(), 'down',)}
                            disabled={!canMove(rowIndex(), 'down',)}
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

                <Show when={!isCollapsed(question, index(),)}>
                <div class="question-body">
                    <div class="form-row">
                        <div class="form-group form-group--grow">
                            <label>Question Text *</label>
                            <input
                                type="text"
                                value={question.question}
                                onChange={(e,) =>
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

                            <label style={{ 'margin-top': '0.5rem', }}>Width</label>
                            <select
                                value={question.width || 'full'}
                                onChange={(e,) =>
                                    updateQuestion(index(), {
                                        width: (e.target as HTMLSelectElement)
                                            .value as 'full' | 'half',
                                    },)}
                            >
                                <option value="full">Full width</option>
                                <option value="half">Half width</option>
                            </select>
                        </div>
                    </div>

                    <Show when={isTextInputType(question.type,)}>
                        <div class="form-group">
                            <Toggle
                                checked={question.questionAsPlaceholder ?? false}
                                onChange={(next,) =>
                                    updateQuestion(index(), { questionAsPlaceholder: next, },)}
                                size="sm"
                                label={
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            'align-items': 'center',
                                            gap: '4px',
                                        }}
                                    >
                                        Use Question Text as placeholder
                                        <Tooltip
                                            header="Use Question Text as placeholder"
                                            content="Hides the field's label and shows the question text inside the input as its placeholder instead. The separate Placeholder Text option is ignored while this is on."
                                        />
                                    </span>
                                }
                            />
                        </div>
                        <Show when={!question.questionAsPlaceholder}>
                            <div class="form-group">
                                <label>Placeholder Text (Optional)</label>
                                <input
                                    type="text"
                                    value={question.placeholder || ''}
                                    onChange={(e,) =>
                                        updateQuestion(index(), {
                                            placeholder: (e.target as HTMLInputElement).value,
                                        },)}
                                    placeholder="Shown inside the empty field…"
                                />
                            </div>
                        </Show>
                    </Show>

                    <Show when={question.type === 'textarea'}>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Number of Rows</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={question.rows ?? 4}
                                    onChange={(e,) =>
                                        updateQuestion(index(), {
                                            rows: Math.max(
                                                1,
                                                parseInt(
                                                    (e.target as HTMLInputElement).value,
                                                    10,
                                                ) || 4,
                                            ),
                                        },)}
                                />
                            </div>
                            <div class="form-group">
                                <label>Resize</label>
                                <Toggle
                                    checked={question.allowResize ?? true}
                                    onChange={(next,) =>
                                        updateQuestion(index(), { allowResize: next, },)}
                                    label="Allow Resize"
                                    size="sm"
                                />
                            </div>
                            <Show when={question.allowResize ?? true}>
                                <div class="form-group">
                                    <label>Max Height</label>
                                    <input
                                        type="text"
                                        value={question.maxHeight || ''}
                                        onChange={(e,) =>
                                            updateQuestion(index(), {
                                                maxHeight: (e.target as HTMLInputElement).value,
                                            },)}
                                        placeholder="e.g. 400px"
                                    />
                                </div>
                            </Show>
                        </div>
                    </Show>

                    <div class="form-group">
                        <label>Help Text (Optional)</label>
                        <input
                            type="text"
                            value={question.description || ''}
                            onChange={(e,) =>
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
                                                onChange={(e,) =>
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
                                class="ui-button ui-button--sm ui-button--secondary"
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
                </Show>
            </div>
        );
    };

    // ─── Sections ───
    /** One section card: header (drag / collapse / ↑ ↓ ×), then — open — its
     *  toolbar, title, alignment, description and its questions. */
    const sectionCard = (sec: FormSectionRow,) => {
        const rowIndex = () => rows().indexOf(sec,);
        const kids = () => childrenOf(sec.id,);
        const open = () => !collapsed().has(sec.id,);
        const toggle = () => {
            const next = new Set(collapsed(),);
            if (next.has(sec.id,)) next.delete(sec.id,); else next.add(sec.id,);
            setCollapsed(next,);
        };
        return (
            <div
                class="question-card question-card--section"
                classList={{
                    'is-collapsed': !open(),
                    'is-dragging': dragFrom() === rowIndex(),
                    'is-drop-before': dropAt()?.index === rowIndex() && !dropAt()!.after && dragFrom() !== rowIndex(),
                    // A question dropped here goes INTO the section (a section dragged here goes after it).
                    'is-drop-into': dropAt()?.index === rowIndex() && dropAt()!.after && dragFrom() !== rowIndex() && !isFormSectionRow(rows()[dragFrom() ?? -1],),
                    'is-drop-after': dropAt()?.index === rowIndex() && dropAt()!.after && dragFrom() !== rowIndex() && isFormSectionRow(rows()[dragFrom() ?? -1],),
                }}
                onDragOver={(e,) => {
                    // Before / into is decided on the HEADER: its top half = above the section.
                    const header = (e.currentTarget as HTMLElement).querySelector(':scope > .question-header',) as HTMLElement | null;
                    const hr = header?.getBoundingClientRect();
                    if (hr && e.clientY > hr.bottom) {
                        if (dragFrom() === null) return;
                        e.preventDefault(); e.stopPropagation();
                        const cur = dropAt();
                        if (!cur || cur.index !== rowIndex() || !cur.after) setDropAt({ index: rowIndex(), after: true, },);
                        return;
                    }
                    onCardDragOver(e, rowIndex(), header,);
                }}
                onDrop={onCardDrop}
            >
                <div
                    class="question-header"
                    draggable={true}
                    title="Drag to reorder · click to collapse"
                    onDragStart={(e,) => {
                        if ((e.target as HTMLElement).closest?.('button, a, input, select, textarea',)) { e.preventDefault(); return; }
                        setDragFrom(rowIndex(),);
                        if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(rowIndex(),),);
                        }
                    }}
                    onDragEnd={() => { setDragFrom(null,); setDropAt(null,); setEndOver(false,); }}
                    onClick={(e,) => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea',)) toggle(); }}
                >
                    <span class="question-number">
                        <button
                            type="button"
                            class="collapse-arrow"
                            classList={{ 'is-open': open(), }}
                            aria-expanded={open()}
                            aria-label={open() ? 'Collapse section' : 'Expand section'}
                            onClick={toggle}
                        />
                        Section
                        <Show when={sec.title}><span class="question-summary">— {sec.title}</span></Show>
                        <span class="question-summary question-summary--count">
                            ({kids().length} {kids().length === 1 ? 'question' : 'questions'})
                        </span>
                    </span>
                    <div class="question-actions">
                        <button type="button" class="btn btn--icon" onClick={() => moveRow(rowIndex(), 'up',)} disabled={!canMove(rowIndex(), 'up',)} title="Move up">↑</button>
                        <button type="button" class="btn btn--icon" onClick={() => moveRow(rowIndex(), 'down',)} disabled={!canMove(rowIndex(), 'down',)} title="Move down">↓</button>
                        <button type="button" class="btn btn--icon btn--danger" onClick={() => setSectionToDelete(sec,)} title="Delete section">×</button>
                    </div>
                </div>
                <Show when={open()}>
                    <div class="question-body section-body">
                        <div class="section-body__toolbar">
                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => addQuestion(sec.id,)}>
                                + Add Question
                            </button>
                        </div>
                        {/* Section settings: text + alignment on the left, the collapse switches on the right. */}
                        <div class="section-body__settings">
                            <div class="section-body__fields">
                                <div class="admin-form-row">
                                    <FormField label="Section title">
                                        <CommitInput value={sec.title} placeholder="e.g. About you" onCommit={(v,) => updateSection(sec.id, { title: v, },)} />
                                    </FormField>
                                    <FormField label="Alignment" tooltip="Alignment of the section title and description on the form.">
                                        <AlignButtons label="Section alignment" value={sec.align} onChange={(v,) => updateSection(sec.id, { align: v, },)} />
                                    </FormField>
                                </div>
                                <FormField label="Description (optional)" hint="Shown under the title. Leave empty to show none.">
                                    <CommitInput multiline value={sec.description} onCommit={(v,) => updateSection(sec.id, { description: v, },)} />
                                </FormField>
                            </div>
                            <div class="section-body__switches">
                                <Toggle
                                    checked={!!sec.collapsible}
                                    onChange={(v,) => updateSection(sec.id, { collapsible: v, collapsed: v ? sec.collapsed : false, },)}
                                    label="Collapsable"
                                    hint="Visitors can collapse and expand this section (an arrow before its title)."
                                />
                                <Toggle
                                    checked={!!sec.collapsible && !!sec.collapsed}
                                    disabled={!sec.collapsible}
                                    onChange={(v,) => updateSection(sec.id, { collapsed: v, },)}
                                    label="Collapsed by default"
                                    hint="Starts closed; the visitor opens it."
                                />
                            </div>
                        </div>
                        <div class="section-body__questions">
                            <For each={kids()} fallback={<p class="form-help-muted section-body__empty">No questions in this section yet — add one, or drag questions onto this section.</p>}>
                                {(q,) => questionCard(q,)}
                            </For>
                        </div>
                    </div>
                </Show>
            </div>
        );
    };

    return (
        <div class="admin-editor form-editor">
            <AdminTitle>{isNew() ? 'New Form' : 'Edit Form'}</AdminTitle>

            {
                /* Leaving with unsaved edits — the admin's own modal, the same one
                every other editor uses. This was a native confirm box until the
                guard was shared. */
            }
            <ConfirmModal
                open={leaveGuard.pending()}
                title="Unsaved changes"
                message={'This form has changes that have not been saved. Leaving now discards them.'}
                confirmLabel="Discard and leave"
                cancelLabel="Stay on this page"
                danger
                onConfirm={leaveGuard.confirmLeave}
                onCancel={leaveGuard.cancelLeave}
            />

            {/* Delete a section: cancel, delete its questions too, or keep them (moved to the root). */}
            <ModalShell open={!!sectionToDelete()} onClose={() => setSectionToDelete(null,)} size="sm" ariaLabel="Delete section">
                <Show when={sectionToDelete()}>
                    {(sec,) => (
                        <div class="section-delete">
                            <h3>Delete section{sec().title ? ` “${sec().title}”` : ''}?</h3>
                            <Show
                                when={childrenOf(sec().id,).length > 0}
                                fallback={<p>This section has no questions.</p>}
                            >
                                <p>
                                    It contains {childrenOf(sec().id,).length} {childrenOf(sec().id,).length === 1 ? 'question' : 'questions'}.
                                    Delete them too, or keep them (they move out of the section, in place)?
                                </p>
                            </Show>
                            <div class="section-delete__actions">
                                <button type="button" class="ui-button ui-button--secondary" onClick={() => setSectionToDelete(null,)}>Cancel</button>
                                <Show
                                    when={childrenOf(sec().id,).length > 0}
                                    fallback={<button type="button" class="ui-button ui-button--danger" onClick={() => deleteSection('keep',)}>Delete section</button>}
                                >
                                    <button type="button" class="ui-button ui-button--secondary" onClick={() => deleteSection('keep',)}>Keep questions, delete section</button>
                                    <button type="button" class="ui-button ui-button--danger" onClick={() => deleteSection('delete',)}>Delete section and questions</button>
                                </Show>
                            </div>
                        </div>
                    )}
                </Show>
            </ModalShell>

            <FormPreviewModal open={previewOpen()} onClose={() => setPreviewOpen(false,)} form={previewForm()} />

            <div class="admin-header">
                <A href="/admin/forms" class="admin-header__back">← Forms</A>
                <h1>{isNew() ? 'New Form' : 'Edit Form'}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                    <Show when={!isNew() && (form()?.submissionCount ?? 0) > 0}>
                        <A
                            href={`/admin/forms/${params.id}/submissions`}
                            class="ui-button ui-button--secondary ui-button--sm"
                        >
                            View Responses ({form()?.submissionCount})
                        </A>
                    </Show>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setPreviewOpen(true,)}>
                        Preview
                    </button>
                    <EditorSaveBar
                        onSave={() => handleSubmit()}
                        onCancel={() => navigate('/admin/forms',)}
                        onDelete={handleDelete}
                        saving={saving()}
                        showDelete={!isNew()}
                        saveLabel="Save Form"
                        deleteLabel="Delete Form"
                    />
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={isNew() || form()} fallback={<div>Loading...</div>}>
                <form onSubmit={handleSubmit} class="admin-form">
                    {/* Form Metadata Section */}
                    <section class="form-section">
                        <h2 class="form-section__toggle" onClick={() => setDetailsOpen(!detailsOpen(),)}>
                            <button
                                type="button"
                                class="collapse-arrow"
                                classList={{ 'is-open': detailsOpen(), }}
                                aria-expanded={detailsOpen()}
                                aria-label={detailsOpen() ? 'Collapse Form Details' : 'Expand Form Details'}
                                onClick={(e,) => { e.stopPropagation(); setDetailsOpen(!detailsOpen(),); }}
                            />
                            Form Details
                        </h2>
                        <Show when={detailsOpen()}>

                        <div class="form-columns">
                            {/* Left column (3/4) — the form's content fields */}
                            <div class="form-columns__main">
                                <FormField label="Title *" class="form-field--block">
                                    <input
                                        type="text"
                                        value={title()}
                                        onInput={handleTitleChange}
                                        required
                                        placeholder="Form title"
                                    />
                                </FormField>

                                <FormField
                                    label="URL Slug *"
                                    hint={`Used in the URL: /forms/${slug() || 'slug'}`}
                                    class="form-field--block"
                                >
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

                                <FormField label="Description" class="form-field--block">
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

                                <FormField label="Success Message" class="form-field--block">
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

                                <FormField label="Submit Button Text" class="form-field--narrow">
                                    <input
                                        type="text"
                                        value={submitButtonText()}
                                        onInput={(e,) => {
                                            setSubmitButtonText((e.target as HTMLInputElement).value,);
                                            markDirty();
                                        }}
                                        placeholder="Submit"
                                    />
                                </FormField>

                                <FormField
                                    label="Max submissions"
                                    tooltip="Stop accepting submissions after this many. Leave blank for unlimited. (An accidental double-submit from the same page load is always de-duplicated automatically.)"
                                >
                                    <input
                                        type="number"
                                        min="0"
                                        value={maxSubmissions()}
                                        onInput={(e,) => {
                                            setMaxSubmissions(e.currentTarget.value,);
                                            markDirty();
                                        }}
                                        placeholder="Unlimited"
                                        style={{ 'max-width': '200px', }}
                                    />
                                </FormField>

                                {/* Boolean options — switch first, then label */}
                                <div class="form-details__toggles">
                                    <Toggle
                                        class="toggle-control--switch-first"
                                        checked={showResults()}
                                        onChange={(next,) => {
                                            setShowResults(next,);
                                            markDirty();
                                        }}
                                        label="Show results to respondents after submission"
                                    />
                                    <Toggle
                                        class="toggle-control--switch-first"
                                        checked={allowMultiple()}
                                        onChange={(next,) => {
                                            setAllowMultiple(next,);
                                            markDirty();
                                        }}
                                        label="Allow multiple submissions per user"
                                    />
                                    <Toggle
                                        class="toggle-control--switch-first"
                                        checked={requiresAuth()}
                                        onChange={(next,) => {
                                            setRequiresAuth(next,);
                                            markDirty();
                                        }}
                                        label="Require sign-in to submit"
                                    />
                                </div>
                            </div>

                            {/* Right column (1/4) — status / meta at the top */}
                            <div class="form-columns__side">
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
                        </div>
                        </Show>
                    </section>

                    {/* On-submit action */}
                    <section class="form-section">
                        <h2 class="form-section__toggle" onClick={() => setSubmitOpen(!submitOpen(),)}>
                            <button
                                type="button"
                                class="collapse-arrow"
                                classList={{ 'is-open': submitOpen(), }}
                                aria-expanded={submitOpen()}
                                aria-label={submitOpen() ? 'Collapse On Submit' : 'Expand On Submit'}
                                onClick={(e,) => { e.stopPropagation(); setSubmitOpen(!submitOpen(),); }}
                            />
                            On Submit
                        </h2>
                        <Show when={submitOpen()}>
                        <FormField
                            label="Action"
                            tooltip="What happens when someone submits this form. Subscribe and Email perform their action; by default the submission is NOT stored for those — enable 'Save submission' to also keep the response."
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '1.25rem',
                                    'flex-wrap': 'wrap',
                                }}
                            >
                                <select
                                    value={action()}
                                    onChange={(e,) => {
                                        setAction(e.currentTarget.value as FormActionType,);
                                        markDirty();
                                    }}
                                    style={{ 'max-width': '320px', }}
                                >
                                    <option value="submit">Save submission (default)</option>
                                    <option value="subscribe">Subscribe to a mailing list</option>
                                    <option value="email">Send an email</option>
                                </select>

                                <Show when={action() === 'subscribe' || action() === 'email'}>
                                    <Toggle
                                        checked={saveSubmission()}
                                        onChange={(next,) => {
                                            setSaveSubmission(next,);
                                            markDirty();
                                        }}
                                        size="sm"
                                        label={
                                            <span
                                                style={{ display: 'inline-flex', 'align-items': 'center', gap: '4px', }}
                                            >
                                                Save submission
                                                <Tooltip
                                                    header="Save submission"
                                                    content="When enabled, the form performs the action above AND stores the submission in the database (viewable under Submissions). When off, only the action runs and no submission is saved."
                                                />
                                            </span>
                                        }
                                    />
                                </Show>

                                {
                                    /* Independent of the action above: a save-only
                                    form should still be able to feed the CRM. */
                                }
                                <Show when={contactsEnabled()}>
                                    <Toggle
                                        checked={addContact()}
                                        onChange={(next,) => {
                                            setAddContact(next,);
                                            markDirty();
                                        }}
                                        size="sm"
                                        label={
                                            <span
                                                style={{ display: 'inline-flex', 'align-items': 'center', gap: '4px', }}
                                            >
                                                Add submitter as a Contact
                                                <Tooltip
                                                    header="Add submitter as a Contact"
                                                    content="Creates a contact from the submission's email, name and phone fields. Matching is on email, so an existing contact is updated rather than duplicated. Off by default — a form is often anonymous feedback, and filing every respondent into the CRM should be a deliberate choice."
                                                />
                                            </span>
                                        }
                                    />
                                </Show>
                            </div>
                        </FormField>

                        {/* Subscribe settings */}
                        <Show when={action() === 'subscribe'}>
                            <div class="form-subaction">
                                <FormField label="Mailing list">
                                    <select
                                        ref={mailingListSelect}
                                        value={mailingListId()}
                                        onChange={(e,) => {
                                            setMailingListId(e.currentTarget.value,);
                                            markDirty();
                                        }}
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
                                            <A href="/admin/mailing-lists">Mailing Lists</A>{' '}
                                            (requires the Mailing Lists feature).
                                        </small>
                                    </Show>
                                    <small class="form-help">
                                        The submitter is added to this list using their <strong>Email</strong>{' '}
                                        field (add an Email question below). The list's double opt-in setting is
                                        respected.
                                    </small>
                                </FormField>
                            </div>
                        </Show>

                        {/* Email settings */}
                        <Show when={action() === 'email'}>
                            <div class="form-subaction">
                                <FormField
                                    label="Send to"
                                    hint="One address, or several separated by commas. Each recipient gets their own copy."
                                    error={emailToError()}
                                >
                                    <input
                                        type="text"
                                        value={emailTo()}
                                        onInput={(e,) => {
                                            setEmailTo(e.currentTarget.value,);
                                            // Clear a stale error as soon as they start fixing it.
                                            if (emailToError()) setEmailToError('',);
                                            markDirty();
                                        }}
                                        onBlur={validateEmailTo}
                                        placeholder="admin@example.com, editor@example.com  (or {{email}})"
                                    />
                                </FormField>
                                <FormField label="Subject">
                                    <input
                                        type="text"
                                        value={emailSubject()}
                                        onInput={(e,) => {
                                            setEmailSubject(e.currentTarget.value,);
                                            markDirty();
                                        }}
                                        placeholder="New submission for {{form_title}}"
                                    />
                                </FormField>
                                <FormField
                                    label="Email body"
                                    hint="Leave empty to send every answer, laid out like the form. Either way the email uses the site's standard branded layout (logo header + footer)."
                                >
                                    <RichTextEditor
                                        value={emailBody()}
                                        onChange={(html,) => {
                                            setEmailBody(html,);
                                            markDirty();
                                        }}
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
                                                    Add questions below to get more variables (save the form to finalize
                                                    their names).
                                                </small>
                                            </Show>
                                            <p class="form-help" style={{ 'margin-top': '8px', }}>
                                                You can also run values through functions, e.g.{' '}
                                                <code>{'{{upper(email)}}'}</code>,{' '}
                                                <code>{'{{formatDate(submitted_at)}}'}</code>, or{' '}
                                                <code>{"{{default(name, 'there')}}"}</code>.
                                            </p>
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </Show>
                        </Show>
                    </section>

                    {/* Questions Section */}
                    <section class="form-section">
                        <div class="section-header">
                            <h2>Questions</h2>
                            <div class="section-header__actions">
                                <Show when={rows().length > 0}>
                                    <button type="button" class="link-button" onClick={collapseAll}>Collapse all</button>
                                    <button type="button" class="link-button" onClick={expandAll}>Expand all</button>
                                </Show>
                                <button type="button" class="link-button" onClick={() => setPreviewOpen(true,)}>
                                    Preview
                                </button>
                                <button type="button" class="ui-button ui-button--secondary" onClick={addSection}>
                                    New Section
                                </button>
                                <button type="button" class="ui-button ui-button--secondary" onClick={() => addQuestion()}>
                                    Add Question
                                </button>
                            </div>
                        </div>

                        <Show when={rows().length === 0}>
                            <div class="empty-state">
                                <p>No questions yet. Click "Add Question" to get started, or "New Section" to group questions under a heading.</p>
                            </div>
                        </Show>

                        {/* Dropping in the gap between cards uses the last indicated position. */}
                        <div
                            class="questions-list"
                            onDragOver={(e,) => { if (dragFrom() !== null) e.preventDefault(); }}
                            onDrop={onCardDrop}
                        >
                            <For each={rootRows()}>
                                {(row,) => (
                                    <Show when={isFormSectionRow(row,) ? row : null} fallback={questionCard(row as FormQuestion,)}>
                                        {(sec,) => sectionCard(sec(),)}
                                    </Show>
                                )}
                            </For>
                            {/* While dragging: a target to move a question out of its section to the end. */}
                            <Show when={dragFrom() !== null}>
                                <div
                                    class="questions-list__end"
                                    classList={{ 'is-over': endOver(), }}
                                    onDragOver={(e,) => { e.preventDefault(); e.stopPropagation(); setDropAt(null,); setEndOver(true,); }}
                                    onDragLeave={() => setEndOver(false,)}
                                    onDrop={(e,) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const from = dragFrom();
                                        if (from !== null) { setRows(dropFormRowAtEnd(rows(), from,),); markDirty(); }
                                        setDragFrom(null,); setDropAt(null,); setEndOver(false,);
                                    }}
                                >
                                    Drop here to move to the end (outside any section)
                                </div>
                            </Show>
                        </div>

                        <Show when={questions().length > 0}>
                            <button type="button" class="ui-button ui-button--secondary" onClick={() => addQuestion()}>
                                Add Another Question
                            </button>
                        </Show>
                    </section>

                </form>
            </Show>
        </div>
    );
};

export default FormEditor;
