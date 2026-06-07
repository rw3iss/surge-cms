import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { AppError, NotFoundError, UnauthorizedError, } from '../core/errors';
import * as forms from '../services/forms';

// ─── Schemas ──────────────────────────────────────────────────────

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

const listQuery = z.object({
    all: z.string().optional(),
    status: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const submissionsQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

const idParams = z.object({ id: z.string(), },);
const slugParams = z.object({ slug: z.string(), },);

// ─── Routes ───────────────────────────────────────────────────────
// Literal/specific paths (/slug/:slug/*, /:id/submissions/export, /bulk)
// before /:id and /:formId/questions catch-alls.

export const formsRoutes = [

    // List forms. Public published-only array by default; admins passing
    // all=true (or status) get the paginated admin list.
    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List forms. Public published-only by default; admins passing all=true/status get the paginated admin list.',
        input: { query: listQuery, },
        handler: async ({ user, apiKey, query, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);

            if (isAdmin && (query.all === 'true' || query.status !== undefined)) {
                const result = await forms.list(
                    { status: query.status, sortBy: query.sortBy, sortOrder: query.sortOrder, },
                    { page: query.page, limit: query.limit, },
                );
                return reply(result.data, { meta: result.meta, },);
            }

            return forms.listPublishedCached();
        },
    },),

    // Form by slug with questions (public, auth-gated).
    defineRoute({
        method: 'get', path: '/slug/:slug', auth: 'optional',
        summary: 'Fetch a published form by slug (with questions). Honors requiresAuth.',
        input: { params: slugParams, },
        handler: ({ params, user, },) => {
            return forms.getPublicBySlug(params.slug, Boolean(user,),).then((res,) => {
                if ('error' in res) {
                    if (res.error === 'not_found') throw new NotFoundError('Form',);
                    throw new UnauthorizedError('Authentication required',);
                }
                return res.form;
            },);
        },
    },),

    // Form results (public, when showResults enabled).
    defineRoute({
        method: 'get', path: '/slug/:slug/results', auth: 'public',
        summary: 'Aggregated public results for a form (when showResults is enabled).',
        input: { params: slugParams, },
        handler: async ({ params, },) => {
            const results = await forms.getResultsBySlug(params.slug,);
            if (!results) throw new NotFoundError('Form or results not available',);
            return results;
        },
    },),

    // Submit a form (public, auth-gated).
    defineRoute({
        method: 'post', path: '/slug/:slug/submit', auth: 'optional',
        summary: 'Submit a form. Enforces requiresAuth, duplicate-submission, and required fields.',
        input: { params: slugParams, body: submissionSchema, },
        handler: async ({ params, body, user, userId, req, },) => {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip!;
            const result = await forms.submit({
                slug: params.slug,
                answers: body.answers,
                userId: userId || null,
                hasUser: Boolean(user,),
                ipAddress,
                userAgent: req.headers['user-agent'],
            },);

            if ('error' in result) {
                if (result.error === 'not_found') throw new NotFoundError('Form',);
                if (result.error === 'unauthorized') throw new UnauthorizedError('Authentication required',);
                throw new AppError(409, 'CONFLICT', 'You have already submitted this form',);
            }
            return reply({ message: result.message, }, { status: 201, },);
        },
    },),

    // Export submissions as CSV (admin, raw).
    defineRoute({
        method: 'get', path: '/:id/submissions/export', auth: 'admin', raw: true,
        summary: 'Export a form\'s submissions as CSV.',
        input: { params: idParams, },
        handler: async ({ params, res, },) => {
            const { csv, filename, } = await forms.exportSubmissionsCsv(params.id,);
            res.setHeader('Content-Type', 'text/csv',);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`,);
            res.send(csv,);
        },
    },),

    // Bulk actions (admin).
    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / delete by id list.',
        handler: ({ body, },) => forms.bulk(body,),
    },),

    // Form by id (admin).
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a form by id (with questions).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const form = await forms.getById(params.id,);
            if (!form) throw new NotFoundError('Form',);
            return form;
        },
    },),

    // Form submissions (admin).
    defineRoute({
        method: 'get', path: '/:id/submissions', auth: 'admin',
        summary: 'List a form\'s submissions.',
        input: { params: idParams, query: submissionsQuery, },
        handler: async ({ params, query, },) => {
            const result = await forms.listSubmissions(params.id, { page: query.page, limit: query.limit, },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Create form (admin).
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a form (optionally with questions).',
        input: { body: formSchema, },
        handler: async ({ body, audit, },) => {
            const form = await forms.create(body, audit(),);
            return reply(form, { status: 201, },);
        },
    },),

    // Update form (admin).
    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a form.',
        input: { params: idParams, body: formSchema.partial(), },
        handler: ({ params, body, audit, },) => forms.update(params.id, body, audit(),),
    },),

    // Add question (admin).
    defineRoute({
        method: 'post', path: '/:id/questions', auth: 'admin',
        summary: 'Add a question to a form.',
        input: { params: idParams, body: questionSchema, },
        handler: async ({ params, body, audit, },) => {
            const question = await forms.addQuestion(params.id, body, audit(),);
            return reply(question, { status: 201, },);
        },
    },),

    // Update question (admin).
    defineRoute({
        method: 'put', path: '/:formId/questions/:questionId', auth: 'admin',
        summary: 'Update a form question.',
        input: {
            params: z.object({ formId: z.string(), questionId: z.string(), },),
            body: questionSchema.partial(),
        },
        handler: ({ params, body, audit, },) => forms.updateQuestion(params.formId, params.questionId, body, audit(),),
    },),

    // Delete question (admin).
    defineRoute({
        method: 'delete', path: '/:formId/questions/:questionId', auth: 'admin',
        summary: 'Delete a form question.',
        input: { params: z.object({ formId: z.string(), questionId: z.string(), },), },
        handler: async ({ params, audit, },) => {
            await forms.deleteQuestion(params.formId, params.questionId, audit(),);
            return { message: 'Question deleted', };
        },
    },),

    // Delete form (admin).
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a form.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await forms.remove(params.id, audit(),);
            return { message: 'Form deleted', };
        },
    },),
];
