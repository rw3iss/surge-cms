/**
 * Font manager HTTP routes.
 *
 * - `GET /fonts` (public) — list all uploaded fonts so the public
 *   site can inject @font-face declarations.
 * - `POST /fonts` (admin) — multipart upload; saves the binary,
 *   inserts the row, returns the new font.
 * - `DELETE /fonts/:id` (admin) — remove file + row.
 *
 * All business logic lives in `sdk/fonts.ts`; these handlers exist
 * to translate HTTP shape into SDK calls (multer payload, response
 * formatting, auth gating).
 */
import { Router, } from 'express';
import multer from 'multer';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { cms, } from '../sdk';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';

const router = Router();

// Memory storage so the SDK can take a Buffer and own the disk write
// path itself. Font files are small (typically < 1MB) so in-memory is
// fine. Bigger limits would warrant disk-staging.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, }, // 5 MB cap per font
},);

router.get('/', async (_req, res,) => {
    try {
        const fonts = await cms.fonts.list();
        sendSuccess(res, fonts,);
    } catch (error) {
        handleRouteError(res, error, 'list fonts',);
    }
},);

router.post(
    '/',
    authenticate(),
    requireAdmin,
    upload.single('file',),
    async (req: AuthenticatedRequest, res,) => {
        try {
            if (!req.file) {
                return res.status(400,).json({
                    success: false,
                    error: { code: 'NO_FILE', message: 'No font file uploaded', },
                },);
            }
            const customId = (req.body?.customId as string | undefined) || undefined;
            const familyName = (req.body?.familyName as string | undefined) || undefined;
            const font = await cms.fonts.create({
                buffer: req.file.buffer,
                originalName: req.file.originalname,
                customId,
                familyName,
            },);
            sendCreated(res, font,);
        } catch (error) {
            handleRouteError(res, error, 'upload font',);
        }
    },
);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const deleted = await cms.fonts.remove(req.params.id,);
        if (!deleted) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Font not found', },
            },);
        }
        sendSuccess(res, deleted,);
    } catch (error) {
        handleRouteError(res, error, 'delete font',);
    }
},);

export default router;
