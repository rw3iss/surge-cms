/**
 * Live rooms (live-show posts) — REST side. The socket lives in `server.ts`
 * (attached in lib.ts); this barrel serves `GET /posts/:id/live` and
 * `POST /posts/:id/live/ticket`.
 */
import type { LiveRoomState, PostLiveTicketResponse, User, } from '@sitesurge/types';
import { ConflictError, NotFoundError, UnauthorizedError, ForbiddenError, } from '../../core/errors';
import { isHost, viewAccess, } from './access';
import { effectiveStatus, loadLivePost, toState, } from './state';
import * as store from './store';
import { createTicket, } from './tickets';

export { createTicket, verifyTicket, TICKET_TTL_SEC, } from './tickets';

async function requireViewable(postId: string, user: User | undefined,) {
    const row = await loadLivePost(postId,);
    const access = await viewAccess(row, user,);
    if (access === 'not_found' || !row) throw new NotFoundError('Live show',);
    if (access === 'unauthorized') throw new UnauthorizedError('Sign in to watch this show',);
    if (access === 'forbidden') throw new ForbiddenError('This show is for subscribers',);
    return row;
}

/** GET /posts/:id/live */
export async function getState(postId: string, user: User | undefined,): Promise<LiveRoomState> {
    const row = await requireViewable(postId, user,);
    return toState(row, await store.totalViewers(row.id,),);
}

/** POST /posts/:id/live/ticket — 409 once the show has ended. */
export async function issueTicketFor(postId: string, user: User | undefined,): Promise<PostLiveTicketResponse> {
    const row = await requireViewable(postId, user,);
    if (effectiveStatus(row,) === 'ended') throw new ConflictError('This show has ended', { code: 'ended', },);
    const userId = user?.id ?? null;
    const { token, expiresAt, } = createTicket(row.id, userId,);
    return { token, expiresAt, userId, isHost: await isHost(user,), };
}
