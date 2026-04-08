import type { Form, } from '@surge/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { ValidationError, } from '../middleware/error';
import * as formsRepo from '../repositories/forms.repo';
import { cache, } from '../services/cache';
import { handleBulkAction, } from '../utils/bulkActions';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

const questionSchema = z.object({
    type: z.enum(['radio', 'checkbox', 'text', 'textarea', 'select', 'number', 'email', 'date',],),
    question: z.string().min(1,),
    description: z.string().nullish(),
    options: z.array(z.string(),).optional(),
    isRequired: z.boolean().optional(),
    order: z.number().int().optional(),
    validation: z.object({
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        pattern: z.string().optional(),
        patternMessage: z.string().optional(),
    },).optional(),
},);

const formSchema = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    description: z.string().optional(),
    status: z.enum(['draft', 'published', 'closed', 'archived',],).optional(),
    showResults: z.boolean().optional(),
    allowMultipleSubmissions: z.boolean().optional(),
    requiresAuth: z.boolean().optional(),
    successMessage: z.string().optional(),
    questions: z.array(questionSchema,).optional(),
},);

const submissionSchema = z.object({
    answers: z.array(z.object({
        questionId: z.string().uuid(),
        value: z.union([z.string(), z.array(z.string(),), z.number(), z.boolean(),],),
    },),),
},);

// ─── Public Routes ───

// Get published forms (public)
router.get('/public', async (_req, res,) => {
    try {
        const cacheKey = 'forms:public';

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const forms = await formsRepo.findPublishedForms();
        await cache.set(cacheKey, forms, 300,);

        sendSuccess(res, forms,);
    } catch (error) {
        handleRouteError(res, error, 'fetch public forms',);
    }
},);

// Get form by slug with questions (public)
router.get('/slug/:slug', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { slug, } = req.params;
        const cacheKey = `form:slug:${slug}`;

        const cached = await cache.get<Form>(cacheKey,);
        if (cached && !cached.requiresAuth) return sendSuccess(res, cached,);

        const form = await formsRepo.findFormBySlug(slug,);
        if (!form) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Form not found', },
            },);
        }

        if (form.requiresAuth && !req.user) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
            },);
        }

        form.questions = await formsRepo.findQuestionsByFormId(form.id,);

        if (!form.requiresAuth) {
            await cache.set(cacheKey, form, 300,);
        }

        sendSuccess(res, form,);
    } catch (error) {
        handleRouteError(res, error, 'fetch form',);
    }
},);

// Get form results (public - if showResults is enabled)
router.get('/slug/:slug/results', async (req, res,) => {
    try {
        const { slug, } = req.params;

        const form = await formsRepo.findFormBySlugWithResults(slug,);
        if (!form) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Form or results not available not found', },
            },);
        }

        const questions = await formsRepo.findQuestionsByFormId(form.id,);
        const submissionRows = await formsRepo.findSubmissionAnswers(form.id,);

        // Calculate results for each question
        const questionResults = questions.map((q,) => {
            const answers = submissionRows
                .map((row,) => {
                    const ans = (row.answers as Array<{ questionId: string; value: unknown; }>)
                        .find((a,) => a.questionId === q.id);
                    return ans?.value;
                },)
                .filter((v,) => v !== undefined);

            let summary;

            if (['radio', 'checkbox', 'select',].includes(q.type,) && q.options) {
                const counts: Record<string, number> = {};
                q.options.forEach((opt,) => {
                    counts[opt] = 0;
                },);

                answers.forEach((ans,) => {
                    if (Array.isArray(ans,)) {
                        ans.forEach((a,) => {
                            if (counts[a] !== undefined) counts[a]++;
                        },);
                    } else if (typeof ans === 'string' && counts[ans] !== undefined) {
                        counts[ans]++;
                    }
                },);

                const total = Object.values(counts,).reduce((a, b,) => a + b, 0,);
                summary = {
                    type: 'choice' as const,
                    options: Object.entries(counts,).map(([value, count,],) => ({
                        value,
                        count,
                        percentage: total > 0 ? (count / total) * 100 : 0,
                    })),
                };
            } else if (q.type === 'number') {
                const nums = answers.filter((a,): a is number => typeof a === 'number');
                if (nums.length > 0) {
                    const sorted = [...nums,].sort((a, b,) => a - b);
                    summary = {
                        type: 'number' as const,
                        min: Math.min(...nums,),
                        max: Math.max(...nums,),
                        average: nums.reduce((a, b,) => a + b, 0,) / nums.length,
                        median: sorted[Math.floor(sorted.length / 2,)],
                    };
                } else {
                    summary = { type: 'number' as const, min: 0, max: 0, average: 0, median: 0, };
                }
            } else {
                const texts = answers.filter((a,): a is string => typeof a === 'string');
                summary = {
                    type: 'text' as const,
                    sampleResponses: texts.slice(0, 5,),
                    totalResponses: texts.length,
                };
            }

            return {
                questionId: q.id,
                question: q.question,
                type: q.type,
                responses: answers.length,
                summary,
            };
        },);

        sendSuccess(res, {
            formId: form.id,
            totalSubmissions: form.submissionCount,
            questionResults,
        },);
    } catch (error) {
        handleRouteError(res, error, 'fetch form results',);
    }
},);

// Submit form (public)
router.post('/slug/:slug/submit', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { slug, } = req.params;
        const data = submissionSchema.parse(req.body,);

        const form = await formsRepo.findFormBySlugPublished(slug,);
        if (!form) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Form not found', },
            },);
        }

        if (form.requiresAuth && !req.user) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
            },);
        }

        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip;

        // Check for duplicate submissions
        if (!form.allowMultipleSubmissions) {
            const isDuplicate = await formsRepo.checkDuplicateSubmission(
                form.id,
                req.userId || null,
                ipAddress!,
            );
            if (isDuplicate) {
                return res.status(409,).json({
                    success: false,
                    error: { code: 'CONFLICT', message: 'You have already submitted this form', },
                },);
            }
        }

        // Get questions and validate required fields
        const questions = await formsRepo.findQuestionsByFormId(form.id,);
        const requiredQuestions = questions.filter((q,) => q.isRequired);

        for (const rq of requiredQuestions) {
            const answer = data.answers.find((a,) => a.questionId === rq.id);
            if (!answer || answer.value === '' || (Array.isArray(answer.value,) && answer.value.length === 0)) {
                throw new ValidationError(`Question "${rq.question}" is required`,);
            }
        }

        const userAgent = req.headers['user-agent'];

        await formsRepo.createSubmission(
            form.id,
            req.userId || null,
            ipAddress!,
            userAgent,
            data.answers,
        );

        await cache.invalidateFormCache(form.id,);

        sendCreated(res, {
            message: form.successMessage || 'Form submitted successfully',
        },);
    } catch (error) {
        handleRouteError(res, error, 'submit form',);
    }
},);

// ─── CSV Export Helpers ───

function escapeCSV(value: string,): string {
    if (value.includes(',',) || value.includes('"',) || value.includes('\n',)) {
        return `"${value.replace(/"/g, '""',)}"`;
    }
    return value;
}

function toCSV(headers: string[], rows: string[][],): string {
    const headerLine = headers.map(escapeCSV,).join(',',);
    const dataLines = rows.map(row => row.map(escapeCSV,).join(',',));
    return [headerLine, ...dataLines,].join('\n',);
}

// ─── Admin Routes ───

// Export form submissions as CSV (admin)
router.get('/:id/submissions/export', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const formId = req.params.id;

        // Fetch form
        const form = await formsRepo.findFormById(formId,);

        // Fetch questions ordered by their position
        const questions = await formsRepo.findQuestionsByFormId(formId,);

        // Fetch all submissions (use a large limit to get all)
        const result = await formsRepo.findSubmissions(formId, { page: 1, limit: 100000, },);
        const submissions = result.data;

        // Build CSV headers
        const headers = ['Submission ID', 'Submitted At', 'User ID', ...questions.map(q => q.question),];

        // Build CSV rows
        const rows = submissions.map(submission => {
            const answers = (submission.answers || []) as Array<{ questionId: string; value: unknown; }>;

            const questionValues = questions.map(q => {
                const answer = answers.find(a => a.questionId === q.id);
                if (!answer) return '';
                if (Array.isArray(answer.value,)) return answer.value.join('; ',);
                return String(answer.value ?? '',);
            },);

            return [
                submission.id,
                submission.submittedAt ? new Date(submission.submittedAt,).toISOString() : '',
                submission.userId || '',
                ...questionValues,
            ];
        },);

        const csv = toCSV(headers, rows,);

        res.setHeader('Content-Type', 'text/csv',);
        res.setHeader('Content-Disposition', `attachment; filename="form-${form.slug}-submissions.csv"`,);
        res.send(csv,);
    } catch (error) {
        handleRouteError(res, error, 'export form submissions',);
    }
},);

// Get all forms (admin)
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, page = 1, limit = 20, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };

        const result = await formsRepo.findForms(
            { status: status as string, },
            pagination,
        );

        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch forms',);
    }
},);

// Get form by ID (admin)
router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const form = await formsRepo.findFormById(req.params.id,);
        form.questions = await formsRepo.findQuestionsByFormId(form.id,);
        sendSuccess(res, form,);
    } catch (error) {
        handleRouteError(res, error, 'fetch form',);
    }
},);

// Get form submissions (admin)
router.get('/:id/submissions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { page = 1, limit = 50, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };

        const result = await formsRepo.findSubmissions(req.params.id, pagination,);

        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch form submissions',);
    }
},);

// Create form (admin)
router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = formSchema.parse(req.body,);
        const form = await formsRepo.createForm(data, req.userId!,);

        // Create questions if provided
        if (data.questions && data.questions.length > 0) {
            for (let i = 0; i < data.questions.length; i++) {
                const q = data.questions[i];
                const question = await formsRepo.createQuestion(form.id, { ...q, order: q.order ?? i, },);
                form.questions.push(question,);
            }
        }

        await cache.invalidateFormCache();

        sendCreated(res, form,);
    } catch (error) {
        handleRouteError(res, error, 'create form',);
    }
},);

// Update form (admin)
router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = formSchema.partial().parse(req.body,);
        const form = await formsRepo.updateForm(req.params.id, data,);

        await cache.invalidateFormCache(req.params.id,);

        sendSuccess(res, form,);
    } catch (error) {
        handleRouteError(res, error, 'update form',);
    }
},);

// Add question to form (admin)
router.post('/:id/questions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = questionSchema.parse(req.body,);
        const question = await formsRepo.createQuestion(req.params.id, data,);

        await cache.invalidateFormCache(req.params.id,);

        sendCreated(res, question,);
    } catch (error) {
        handleRouteError(res, error, 'add question',);
    }
},);

// Update question (admin)
router.put('/:formId/questions/:questionId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { formId, questionId, } = req.params;
        const data = questionSchema.partial().parse(req.body,);
        const question = await formsRepo.updateQuestion(formId, questionId, data,);

        await cache.invalidateFormCache(formId,);

        sendSuccess(res, question,);
    } catch (error) {
        handleRouteError(res, error, 'update question',);
    }
},);

// Delete question (admin)
router.delete(
    '/:formId/questions/:questionId',
    authenticate(),
    requireAdmin,
    async (req: AuthenticatedRequest, res,) => {
        try {
            const { formId, questionId, } = req.params;
            await formsRepo.deleteQuestion(formId, questionId,);

            await cache.invalidateFormCache(formId,);

            sendSuccess(res, { message: 'Question deleted', },);
        } catch (error) {
            handleRouteError(res, error, 'delete question',);
        }
    },
);

// Delete form (admin)
router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await formsRepo.deleteForm(req.params.id,);

        await cache.invalidateFormCache(req.params.id,);

        sendSuccess(res, { message: 'Form deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete form',);
    }
},);

// ─── Bulk Actions ───

router.post('/bulk', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    await handleBulkAction(res, req.body, {
        table: 'forms',
        allowedStatuses: ['draft', 'published', 'closed', 'archived',],
        softDelete: false,
        onInvalidate: () => cache.invalidateFormCache(),
    },);
},);

export default router;
