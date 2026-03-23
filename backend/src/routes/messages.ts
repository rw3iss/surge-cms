import { Router, } from 'express';
import { z, } from 'zod';
import { config, } from '../config';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import * as messagesRepo from '../repositories/messages.repo';
import { sendEmail, } from '../services/email';
import { logger, } from '../utils/logger';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';
import { sanitize, } from '../utils/sanitize';

const router = Router();

const messageSchema = z.object({
    name: z.string().min(1,).max(255,),
    email: z.string().email(),
    subject: z.string().max(255,).optional(),
    message: z.string().min(1,).max(5000,),
},);

const updateStatusSchema = z.object({
    status: z.enum(['unread', 'read', 'replied', 'archived', 'spam',],),
},);

// Submit contact message (public)
router.post('/', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const data = messageSchema.parse(req.body,);

        // Sanitize user-submitted content
        data.name = sanitize(data.name,);
        data.message = sanitize(data.message,);
        if (data.subject) data.subject = sanitize(data.subject,);

        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip;
        const userAgent = req.headers['user-agent'];

        await messagesRepo.createMessage(data, req.userId || null, ipAddress!, userAgent,);

        // Send email notification to admin
        try {
            await sendEmail({
                to: config.adminEmails[0] || config.email.from || 'admin@surgemedia.us',
                subject: `New Contact Message: ${data.subject || 'No Subject'}`,
                html: `
          <h2>New Contact Message</h2>
          <p><strong>From:</strong> ${data.name} (${data.email})</p>
          <p><strong>Subject:</strong> ${data.subject || 'No Subject'}</p>
          <p><strong>Message:</strong></p>
          <p>${data.message.replace(/\n/g, '<br>',)}</p>
          <hr>
          <p><small>IP: ${ipAddress}</small></p>
        `,
            },);
        } catch (emailError) {
            logger.warn('Failed to send email notification', { error: emailError, },);
        }

        sendCreated(res, { message: 'Message sent successfully', },);
    } catch (error) {
        handleRouteError(res, error, 'submit contact message',);
    }
},);

// Get all messages (admin)
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, search, page = 1, limit = 50, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };

        const result = await messagesRepo.findMessages(
            { status: status as string, search: search as string, },
            pagination,
        );

        sendSuccess(res, result.data, {
            page: pagination.page,
            limit: pagination.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / pagination.limit,),
        },);
    } catch (error) {
        handleRouteError(res, error, 'fetch messages',);
    }
},);

// Get message by ID (admin)
router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const message = await messagesRepo.findMessageById(req.params.id,);
        sendSuccess(res, message,);
    } catch (error) {
        handleRouteError(res, error, 'fetch message',);
    }
},);

// Update message status (admin)
router.put('/:id/status', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, } = updateStatusSchema.parse(req.body,);
        const message = await messagesRepo.updateMessageStatus(req.params.id, status, req.userId,);
        sendSuccess(res, message,);
    } catch (error) {
        handleRouteError(res, error, 'update message status',);
    }
},);

// Delete message (admin)
router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await messagesRepo.deleteMessage(req.params.id,);
        sendSuccess(res, { message: 'Message deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete message',);
    }
},);

// Bulk update status (admin)
router.post('/bulk-status', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { messageIds, status, } = z.object({
            messageIds: z.array(z.string().uuid(),),
            status: z.enum(['unread', 'read', 'replied', 'archived', 'spam',],),
        },).parse(req.body,);

        await messagesRepo.bulkUpdateStatus(messageIds, status,);

        sendSuccess(res, { message: `${messageIds.length} messages updated`, },);
    } catch (error) {
        handleRouteError(res, error, 'bulk update messages',);
    }
},);

// Bulk delete (admin)
router.post('/bulk-delete', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { messageIds, } = z.object({
            messageIds: z.array(z.string().uuid(),),
        },).parse(req.body,);

        await messagesRepo.bulkDelete(messageIds,);

        sendSuccess(res, { message: `${messageIds.length} messages deleted`, },);
    } catch (error) {
        handleRouteError(res, error, 'bulk delete messages',);
    }
},);

export default router;
