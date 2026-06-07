/**
 * Font manager routes.
 *
 * - `GET /fonts` (public) — list uploaded fonts so the public site can
 *   inject @font-face declarations.
 * - `POST /fonts` (admin) — multipart upload (multer single 'file');
 *   saves the binary, inserts the row, returns the new font.
 * - `DELETE /fonts/:id` (admin) — remove file + row.
 *
 * Business logic lives in `services/fonts.ts`.
 */
import multer from 'multer';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { AppError, NotFoundError, } from '../core/errors';
import * as fonts from '../services/fonts';

// Memory storage so the service can take a Buffer and own the disk write
// path itself. Font files are small (typically < 1MB) so in-memory is
// fine. Bigger limits would warrant disk-staging.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, }, // 5 MB cap per font
},);

export const fontsRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'public',
        summary: 'List all uploaded fonts (with @font-face source URLs).',
        handler: () => fonts.list(),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Upload a font (multipart, field "file"). Optional customId / familyName.',
        pre: [upload.single('file',),],
        handler: async ({ req, },) => {
            const file = (req as { file?: Express.Multer.File; }).file;
            if (!file) throw new AppError(400, 'NO_FILE', 'No font file uploaded',);
            const body = req.body as { customId?: string; familyName?: string; };
            const font = await fonts.create({
                buffer: file.buffer,
                originalName: file.originalname,
                customId: body?.customId || undefined,
                familyName: body?.familyName || undefined,
            },);
            return reply(font, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a font (file + row).',
        input: { params: z.object({ id: z.string(), },), },
        handler: async ({ params, },) => {
            const deleted = await fonts.remove(params.id,);
            if (!deleted) throw new NotFoundError('Font',);
            return deleted;
        },
    },),
];
