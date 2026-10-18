/**
 * The upload half of the gallery Publish (A1), separated from the admin page
 * so the riskiest flow — partial-upload recovery — is unit-tested.
 *
 * Staged files upload ONE AT A TIME. Each success is reported at once
 * (`onUploaded`), so the page converts that row to a library row: if a later
 * upload (or the publish call) fails, a retry uploads only the files that are
 * still staged — never the same file twice. A file cancelled before or during
 * its turn is skipped.
 */
import type { DraftItem, } from './galleryDraft';

/** Thrown by `upload` when the user cancelled that row's upload. */
export interface CancelledLike { name: string; }

export interface UploadStagedDeps {
    /** The CURRENT draft rows (rows may be cancelled / removed while uploading). */
    rows: () => DraftItem[];
    /** Upload one row's file; resolves with the new media id. */
    upload: (row: DraftItem,) => Promise<string>;
    /** True for the error `upload` throws when the row was cancelled. */
    isCancelled: (e: unknown,) => boolean;
    /** Called right after each successful upload. */
    onUploaded: (key: string, mediaId: string,) => void;
}

/**
 * Upload every staged, non-removed row. Resolves with key → media id of
 * everything uploaded; on a failure rejects with that error after reporting
 * the successes (they are in `uploaded` on the thrown error too).
 */
export async function uploadStaged(deps: UploadStagedDeps,): Promise<Map<string, string>> {
    const uploaded = new Map<string, string>();
    const stillStaged = (key: string,) => deps.rows().some((x,) => x.key === key && x.file && !x.removed,);
    const queue = deps.rows().filter((x,) => x.file && !x.removed,).map((x,) => x.key);
    for (const key of queue) {
        if (!stillStaged(key,)) continue; // cancelled before its turn
        const row = deps.rows().find((x,) => x.key === key,)!;
        let mediaId: string;
        try {
            mediaId = await deps.upload(row,);
        } catch (e) {
            if (deps.isCancelled(e,)) continue;
            throw Object.assign(e instanceof Error ? e : new Error(String(e,),), { uploaded, },);
        }
        uploaded.set(key, mediaId,);
        deps.onUploaded(key, mediaId,);
    }
    return uploaded;
}
