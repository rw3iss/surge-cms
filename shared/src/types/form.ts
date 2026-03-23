export type FormStatus = 'draft' | 'published' | 'closed' | 'archived';

export type QuestionType =
    | 'radio'
    | 'checkbox'
    | 'text'
    | 'textarea'
    | 'select'
    | 'number'
    | 'email'
    | 'date';

export interface FormQuestion {
    id: string;
    formId: string;
    type: QuestionType;
    question: string;
    description?: string;
    options?: string[];
    isRequired: boolean;
    order: number;
    validation?: QuestionValidation;
    createdAt: Date;
    updatedAt: Date;
}

export interface QuestionValidation {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
}

export interface Form {
    id: string;
    title: string;
    slug: string;
    description?: string;
    status: FormStatus;
    showResults: boolean;
    allowMultipleSubmissions: boolean;
    requiresAuth: boolean;
    successMessage?: string;
    questions: FormQuestion[];
    submissionCount: number;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    closedAt?: Date;
}

export interface FormSubmission {
    id: string;
    formId: string;
    userId?: string;
    ipAddress: string;
    userAgent?: string;
    answers: FormAnswer[];
    submittedAt: Date;
}

export interface FormAnswer {
    questionId: string;
    value: string | string[] | number | boolean;
}

export interface FormResults {
    formId: string;
    totalSubmissions: number;
    questionResults: QuestionResult[];
}

export interface QuestionResult {
    questionId: string;
    question: string;
    type: QuestionType;
    responses: number;
    summary: QuestionSummary;
}

export type QuestionSummary =
    | ChoiceSummary
    | TextSummary
    | NumberSummary;

export interface ChoiceSummary {
    type: 'choice';
    options: Array<{
        value: string;
        count: number;
        percentage: number;
    }>;
}

export interface TextSummary {
    type: 'text';
    sampleResponses: string[];
    totalResponses: number;
}

export interface NumberSummary {
    type: 'number';
    min: number;
    max: number;
    average: number;
    median: number;
}
