/**
 * The operator's upload policy, shared by every upload path: the classic
 * multer routes (`routes/media.ts`) AND the direct multipart sessions
 * (`services/video/uploads.ts`). Before this lived in one place, a non-video
 * file sent as a multipart session (anything > 50 MB, and every SDK caller
 * using sessions) skipped both the MIME allow-list and the size cap.
 *
 * `ALLOWED_FILE_TYPES` is enforced only when the operator sets it explicitly:
 * its built-in default omits common types (SVG, AVIF, MP3 variants) that
 * existing sites already upload, and starting to refuse them would be a
 * regression. Entries may end in `/*` (e.g. `image/*`).
 *
 * Videos are sized by the video settings' `maxUploadGb` instead (they are
 * the reason sessions exist); everything else by `UPLOAD_MAX_SIZE_MB`.
 */
import { config, } from '../config';
import { ValidationError, } from '../core/errors';

function allowList(): string[] | null {
    return process.env.ALLOWED_FILE_TYPES
        ? config.upload.allowedTypes.map((t,) => t.trim().toLowerCase()).filter(Boolean,)
        : null;
}

/** May a file of this MIME type be uploaded? */
export function isAllowedType(mime: string,): boolean {
    const list = allowList();
    if (!list) return true;
    const m = mime.toLowerCase();
    return list.some((t,) => (t.endsWith('/*',) ? m.startsWith(t.slice(0, -1,),) : m === t));
}

/** The non-video size cap in bytes. */
export function maxFileBytes(): number {
    return config.upload.maxSizeMb * 1024 * 1024;
}

/** Throw a ValidationError when a NON-video file breaks the policy. */
export function assertFileAllowed(mime: string, size: number,): void {
    if (!isAllowedType(mime,)) throw new ValidationError(`File type not allowed: ${mime}`,);
    if (size > maxFileBytes()) throw new ValidationError(`File is larger than the ${config.upload.maxSizeMb} MB upload limit`,);
}
