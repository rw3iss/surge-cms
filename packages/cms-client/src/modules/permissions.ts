import type {
    PermissionGrant,
    PermissionKey,
    PermissionWithGrants,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /permissions — the granular permission layer over the role ladder.
 *
 * `mine()` is the one call a UI makes on every load to decide what to render;
 * everything else is admin-only management.
 */
export class PermissionsModule extends ModuleBase {
    protected readonly module = 'permissions';

    /** GET /permissions — catalog + grants (admin). */
    list(): Promise<PermissionWithGrants[]> {
        return this.get<PermissionWithGrants[]>('/permissions', { options: { cache: false, }, },);
    }

    /** GET /permissions/me — the caller's own resolved answers. */
    mine(): Promise<Record<PermissionKey, boolean>> {
        return this.get<Record<PermissionKey, boolean>>('/permissions/me', {
            options: { cache: false, },
        },);
    }

    /** GET /permissions/user/:id — one user's grants + resolved answers. */
    forUser(userId: string,): Promise<{
        userId: string;
        grants: PermissionGrant[];
        resolved: Record<PermissionKey, boolean>;
    }> {
        return this.get('/permissions/user/:key', {
            params: { key: userId, }, options: { cache: false, },
        },);
    }

    create(body: {
        key: string; label: string; feature?: string; description?: string | null;
        action?: string | null; defaultAccess?: 'everyone' | 'roles' | 'nobody';
        defaultRoles?: string[];
    },): Promise<PermissionWithGrants> {
        return this.mutate('POST', '/permissions', { body, invalidates: ['permissions',], },);
    }

    update(key: string, body: {
        label?: string; description?: string | null;
        defaultAccess?: 'everyone' | 'roles' | 'nobody'; defaultRoles?: string[];
    },): Promise<PermissionWithGrants> {
        return this.mutate('PUT', '/permissions/:key', {
            params: { key, }, body, invalidates: ['permissions',],
        },);
    }

    remove(key: string,): Promise<{ message: string; }> {
        return this.mutate('DELETE', '/permissions/:key', {
            params: { key, }, invalidates: ['permissions',],
        },);
    }

    /** Grant or DENY (`granted: false`) to a role or a specific user. */
    setGrant(key: string, body: {
        subjectType: 'role' | 'user'; subjectId: string; granted?: boolean;
    },): Promise<{ message: string; }> {
        return this.mutate('POST', '/permissions/:key/grants', {
            params: { key, }, body, invalidates: ['permissions',],
        },);
    }

    /** Remove a grant so the subject falls back to the permission's default. */
    removeGrant(key: string, subjectType: 'role' | 'user', subjectId: string,): Promise<{ message: string; }> {
        return this.mutate('DELETE', '/permissions/:key/grants', {
            params: { key, }, query: { subjectType, subjectId, }, invalidates: ['permissions',],
        },);
    }
}
