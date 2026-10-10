/**
 * /api/v1/comments — the Comments feature: per-item switches (Enable
 * commenting / anonymous / locked) and the feature's settings. Comment CRUD
 * itself lives in the engine (`/api/v1/discussions`).
 */
import type { CommentsSettings, CommentThreadSettings, } from '../../types/discussions';

export interface CommentsThreadParams { targetType: string; targetId: string; }

/** GET /comments/threads/:targetType/:targetId — defaults when never set. */
export type CommentsThreadResponse = CommentThreadSettings;

export interface CommentsThreadUpdateBody {
    enabled?: boolean;
    allowAnonymous?: boolean;
    locked?: boolean;
}
export type CommentsThreadUpdateResponse = CommentThreadSettings;

export type CommentsSettingsResponse = CommentsSettings;
export type CommentsSettingsBody = Partial<CommentsSettings>;
