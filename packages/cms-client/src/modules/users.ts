import type { UserInvite, UserInviteBody, UserInviteResult, } from '@sitesurge/types';
import type {
    UserListQuery, UserListResponse, UserByIdResponse, UserCreateBody,
    UserCreateResponse, UserUpdateBody, UserUpdateResponse, UserAvatarUploadResponse,
    UserPasswordBody, UserPasswordResponse, UserBanBody, UserBanResponse,
    UserUnbanResponse, UserDeleteResponse, UserBanListQuery, UserBanListResponse,
    UserBanIpBody, UserBanIpResponse, UserBanDeleteResponse, UserAuthorsResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';
import type { UserSubscriptionInfo, } from '@sitesurge/types';

/** /users namespace (all admin) — user CRUD, avatar upload, bans. */
export class UsersModule extends ModuleBase {
    protected readonly module = 'users';

    /** GET /users — paginated admin list with search/role/status/sort filters. */
    /** GET /users/invites — account invites, newest first (needs `users:invite`). */
    invites(): Promise<UserInvite[]> {
        return this.get<UserInvite[]>('/users/invites', { options: { cache: false, }, },);
    }

    /** POST /users/invites — invite (3-day link) or, for an existing account, add the roles now. */
    invite(body: UserInviteBody,): Promise<UserInviteResult> {
        return this.mutate<UserInviteResult>('POST', '/users/invites', { body, invalidates: ['users',], },);
    }

    /** POST /users/invites/:id/resend — a fresh link (the old one stops working). */
    resendInvite(id: string,): Promise<UserInvite> {
        return this.mutate<UserInvite>('POST', '/users/invites/:inviteId/resend', { params: { inviteId: id, }, },);
    }

    /** DELETE /users/invites/:id — revoke a pending invite. */
    revokeInvite(id: string,): Promise<{ ok: true; }> {
        return this.mutate<{ ok: true; }>('DELETE', '/users/invites/:inviteId', { params: { inviteId: id, }, },);
    }

    /** POST /users/:id/verification/resend — a fresh verification link (`sent:false` when already verified). */
    resendVerification(id: string,): Promise<{ sent: boolean; }> {
        return this.mutate<{ sent: boolean; }>('POST', '/users/:id/verification/resend', { params: { id, }, },);
    }

    /** POST /users/:id/verification/verify — mark the email verified by hand (audited). */
    markEmailVerified(id: string,): Promise<UserByIdResponse['user']> {
        return this.mutate<UserByIdResponse['user']>('POST', '/users/:id/verification/verify', { params: { id, }, invalidates: ['users',], },);
    }

    /** POST /users/bulk — one action on many users (skips you, and sysadmins unless you are one). */
    bulk(body: { ids: string[]; action: 'delete' | 'ban' | 'unban' | 'activate' | 'deactivate' | 'role'; value?: string; },): Promise<{ done: number; skipped: Array<{ id: string; reason: string; }>; }> {
        return this.mutate<{ done: number; skipped: Array<{ id: string; reason: string; }>; }>('POST', '/users/bulk', { body, invalidates: ['users',], },);
    }

    list(query?: UserListQuery,): Promise<Paginated<UserListResponse[number]>> {
        return this.getPaged<UserListResponse[number]>('/users', { query: query as Record<string, unknown>, },);
    }

    /** GET /users/authors — staff users (admin/sysadmin/editor) for post author attribution. */
    authors(): Promise<UserAuthorsResponse> {
        return this.get<UserAuthorsResponse>('/users/authors',);
    }

    /** GET /users/:id — user with their resolved Patreon membership (or null). */
    getById(id: string,): Promise<UserByIdResponse> {
        return this.get<UserByIdResponse>('/users/:id', { params: { id, }, },);
    }

    create(body: UserCreateBody,): Promise<UserCreateResponse> {
        return this.mutate<UserCreateResponse>('POST', '/users', { body, invalidates: ['users', 'entities',], },);
    }

    update(id: string, body: UserUpdateBody,): Promise<UserUpdateResponse> {
        return this.mutate<UserUpdateResponse>('PUT', '/users/:id', { params: { id, }, body, invalidates: ['users', 'entities',], },);
    }

    remove(id: string,): Promise<UserDeleteResponse> {
        return this.mutate<UserDeleteResponse>('DELETE', '/users/:id', { params: { id, }, invalidates: ['users', 'entities',], },);
    }

    /** POST /users/:id/password — set a new password. */
    setPassword(id: string, body: UserPasswordBody,): Promise<UserPasswordResponse> {
        return this.mutate<UserPasswordResponse>('POST', '/users/:id/password', { params: { id, }, body, invalidates: ['users', 'entities',], },);
    }

    /** POST /users/:id/avatar — multipart upload (field "avatar"; resized to 256×256 webp). */
    uploadAvatar(id: string, file: Blob,): Promise<UserAvatarUploadResponse> {
        const form = new FormData();
        form.append('avatar', file,);
        return super.uploadForm<UserAvatarUploadResponse>('/users/:id/avatar', form, { params: { id, }, invalidates: ['users', 'entities',], },);
    }

    // ─── Bans ─────────────────────────────────────────────────────
    ban(id: string, body?: UserBanBody,): Promise<UserBanResponse> {
        return this.mutate<UserBanResponse>('POST', '/users/:id/ban', { params: { id, }, body, invalidates: ['users', 'entities',], },);
    }

    unban(id: string,): Promise<UserUnbanResponse> {
        return this.mutate<UserUnbanResponse>('POST', '/users/:id/unban', { params: { id, }, invalidates: ['users', 'entities',], },);
    }

    banIp(body: UserBanIpBody,): Promise<UserBanIpResponse> {
        return this.mutate<UserBanIpResponse>('POST', '/users/ban-ip', { body, invalidates: ['users', 'entities',], },);
    }

    /** GET /users/banned/list — active bans. Page meta on the envelope. */
    listBanned(query?: UserBanListQuery,): Promise<Paginated<UserBanListResponse[number]>> {
        return this.getPaged<UserBanListResponse[number]>('/users/banned/list', { query: query as Record<string, unknown>, },);
    }

    /** DELETE /users/banned/:banId — remove a ban row. */
    removeBan(banId: string,): Promise<UserBanDeleteResponse> {
        return this.mutate<UserBanDeleteResponse>('DELETE', '/users/banned/:banId', { params: { banId, }, invalidates: ['users', 'entities',], },);
    }

    /** GET /users/:id/subscription — the user's tier (paid, manual or free). */
    subscription(id: string,): Promise<UserSubscriptionInfo> {
        return this.get<UserSubscriptionInfo>('/users/:id/subscription', { params: { id, }, options: { cache: false, }, },);
    }

    /** PUT /users/:id/subscription — put the user on a tier by hand (null / free ends a manual one). */
    /** `endsAt` (ISO): the hand-assigned membership ends then (a daily sweep moves the user off it); omitted/null = no end. */
    assignSubscription(id: string, tierId: string | null, endsAt?: string | null,): Promise<UserSubscriptionInfo> {
        return this.mutate<UserSubscriptionInfo>('PUT', '/users/:id/subscription', { params: { id, }, body: { tierId, ...(endsAt !== undefined ? { endsAt, } : {}), }, invalidates: ['users', 'subscriptionTiers',], },);
    }
}
