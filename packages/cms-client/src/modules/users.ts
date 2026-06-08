import type {
    UserListQuery, UserListResponse, UserByIdResponse, UserCreateBody,
    UserCreateResponse, UserUpdateBody, UserUpdateResponse, UserAvatarUploadResponse,
    UserPasswordBody, UserPasswordResponse, UserBanBody, UserBanResponse,
    UserUnbanResponse, UserDeleteResponse, UserBanListQuery, UserBanListResponse,
    UserBanIpBody, UserBanIpResponse, UserBanDeleteResponse,
} from '@rw/cms-shared';
import { ModuleBase, } from './base';

/** /users namespace (all admin) — user CRUD, avatar upload, bans. */
export class UsersModule extends ModuleBase {
    protected readonly module = 'users';

    /** GET /users — paginated admin list with search/role/status/sort filters. */
    list(query?: UserListQuery,): Promise<UserListResponse> {
        return this.get<UserListResponse>('/users', { query: query as Record<string, unknown>, },);
    }

    /** GET /users/:id — user with their resolved Patreon membership (or null). */
    getById(id: string,): Promise<UserByIdResponse> {
        return this.get<UserByIdResponse>('/users/:id', { params: { id, }, },);
    }

    create(body: UserCreateBody,): Promise<UserCreateResponse> {
        return this.mutate<UserCreateResponse>('POST', '/users', { body, invalidates: ['users',], },);
    }

    update(id: string, body: UserUpdateBody,): Promise<UserUpdateResponse> {
        return this.mutate<UserUpdateResponse>('PUT', '/users/:id', { params: { id, }, body, invalidates: ['users',], },);
    }

    remove(id: string,): Promise<UserDeleteResponse> {
        return this.mutate<UserDeleteResponse>('DELETE', '/users/:id', { params: { id, }, invalidates: ['users',], },);
    }

    /** POST /users/:id/password — set a new password. */
    setPassword(id: string, body: UserPasswordBody,): Promise<UserPasswordResponse> {
        return this.mutate<UserPasswordResponse>('POST', '/users/:id/password', { params: { id, }, body, invalidates: ['users',], },);
    }

    /** POST /users/:id/avatar — multipart upload (field "avatar"; resized to 256×256 webp). */
    uploadAvatar(id: string, file: Blob,): Promise<UserAvatarUploadResponse> {
        const form = new FormData();
        form.append('avatar', file,);
        return super.uploadForm<UserAvatarUploadResponse>('/users/:id/avatar', form, { params: { id, }, invalidates: ['users',], },);
    }

    // ─── Bans ─────────────────────────────────────────────────────
    ban(id: string, body?: UserBanBody,): Promise<UserBanResponse> {
        return this.mutate<UserBanResponse>('POST', '/users/:id/ban', { params: { id, }, body, invalidates: ['users',], },);
    }

    unban(id: string,): Promise<UserUnbanResponse> {
        return this.mutate<UserUnbanResponse>('POST', '/users/:id/unban', { params: { id, }, invalidates: ['users',], },);
    }

    banIp(body: UserBanIpBody,): Promise<UserBanIpResponse> {
        return this.mutate<UserBanIpResponse>('POST', '/users/ban-ip', { body, invalidates: ['users',], },);
    }

    /** GET /users/banned/list — active bans. Page meta on the envelope. */
    listBanned(query?: UserBanListQuery,): Promise<UserBanListResponse> {
        return this.get<UserBanListResponse>('/users/banned/list', { query: query as Record<string, unknown>, },);
    }

    /** DELETE /users/banned/:banId — remove a ban row. */
    removeBan(banId: string,): Promise<UserBanDeleteResponse> {
        return this.mutate<UserBanDeleteResponse>('DELETE', '/users/banned/:banId', { params: { banId, }, invalidates: ['users',], },);
    }
}
