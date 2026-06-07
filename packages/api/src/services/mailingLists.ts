/**
 * Mailing lists service.
 *
 * Owns list CRUD, subscriber CRUD / bulk / force-confirm, and the public
 * subscribe flow (including double-opt-in confirmation email). The route
 * layer in `routes/mailingLists.ts` thinly wraps this module.
 */
import { randomBytes, } from 'crypto';
import { NotFoundError, ValidationError, } from '../core/errors';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import { logAudit, } from './audit';
import { cache, } from './cache';
import { sendEmail, } from './email';
import { config, } from '../config';
import type { AuditContext, } from './types';
import { uuidOrNull, } from '../utils/uuid';

export interface ListInput {
    slug: string;
    name: string;
    description?: string;
    isEnabled?: boolean;
    registeredUsersOnly?: boolean;
    doubleOptIn?: boolean;
    defaultTemplateId?: string | null;
}

export interface SubscriberAdminInput {
    email: string;
    name?: string;
    phone?: string;
    customFields?: Record<string, unknown>;
}

export interface PublicSubscribeInput {
    email?: string;
    name?: string;
    phone?: string;
    customFields?: Record<string, unknown>;
}

// ─── Lists ───────────────────────────────────────────────────────────

export function list() {
    return lists.list();
}

export async function getById(id: string,) {
    const item = await lists.findById(id,);
    if (!item) throw new NotFoundError('Mailing list',);
    return item;
}

export async function create(input: ListInput, ctx: AuditContext,) {
    // created_by is a UUID FK — synthetic actors → NULL.
    const created = await lists.create({ ...input, createdBy: uuidOrNull(ctx.userId,), },);
    await cache.invalidateMailingListsCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'mailing_list',
        entityId: created.id,
        newValues: { ...created, } as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return created;
}

export async function update(id: string, patch: Partial<ListInput>, ctx: AuditContext,) {
    const updated = await lists.update(id, patch,);
    if (!updated) throw new NotFoundError('Mailing list',);
    await cache.invalidateMailingListsCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'mailing_list',
        entityId: id,
        newValues: patch as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return updated;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    await lists.remove(id,);
    await cache.invalidateMailingListsCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'mailing_list',
        entityId: id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

// ─── Subscribers (admin) ─────────────────────────────────────────────

export function listSubscribers(
    listId: string,
    opts: {
        limit?: number;
        offset?: number;
        search?: string;
        status?: Parameters<typeof subs.list>[0]['status'];
    },
) {
    return subs.list({ listId, limit: opts.limit, offset: opts.offset, search: opts.search, status: opts.status, },);
}

/** Admin add — force confirmed. Idempotent: re-add reactivates. */
export async function addSubscriber(listId: string, input: SubscriberAdminInput,) {
    const existing = await subs.findByEmail(listId, input.email,);
    if (existing) {
        if (existing.status !== 'subscribed') await subs.setStatus(existing.id, 'subscribed',);
        return { subscriber: existing, created: false, };
    }
    const created = await subs.create({
        listId,
        email: input.email,
        name: input.name,
        phone: input.phone,
        customFields: input.customFields,
        status: 'subscribed',
    },);
    return { subscriber: created, created: true, };
}

export async function updateSubscriber(subId: string, patch: Record<string, unknown>,) {
    const updated = await subs.update(subId, patch,);
    if (!updated) throw new NotFoundError('Subscriber',);
    return updated;
}

export async function removeSubscriber(subId: string,): Promise<void> {
    await subs.remove(subId,);
}

export async function bulkRemoveSubscribers(listId: string, ids: string[], ctx: AuditContext,): Promise<{ removed: number; }> {
    await subs.bulkRemove(ids,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'mailing_list_subscribers',
        entityId: listId,
        newValues: { count: ids.length, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { removed: ids.length, };
}

export async function forceConfirmSubscriber(subId: string,) {
    const sub = await subs.findById(subId,);
    if (!sub) throw new NotFoundError('Subscriber',);
    await subs.setStatus(sub.id, 'subscribed',);
    await subs.clearConfirmationToken(sub.id,);
    return subs.findById(sub.id,);
}

// ─── Public subscribe (double opt-in) ────────────────────────────────

/**
 * Public subscribe by list slug. For registered-users-only lists the
 * caller must supply an authenticated user (email/userId derived from
 * the session); otherwise an email is required. Double-opt-in lists
 * create a pending row + fire a confirmation email.
 */
export async function publicSubscribe(
    slug: string,
    input: PublicSubscribeInput,
    actor: { userId?: string; userEmail?: string; },
) {
    const list = await lists.findBySlug(slug,);
    if (!list || !list.isEnabled) throw new NotFoundError('List',);

    let email = input.email;
    let userId: string | null = null;

    if (list.registeredUsersOnly) {
        if (!actor.userId || !actor.userEmail) {
            throw new ValidationError('Login required to subscribe to this list',);
        }
        email = actor.userEmail;
        // user_id is a UUID FK — synthetic actors → NULL.
        userId = uuidOrNull(actor.userId,);
    }
    if (!email) throw new ValidationError('Email is required',);

    const existing = await subs.findByEmail(list.id, email,);
    const wantsDoubleOpt = list.doubleOptIn;
    const targetStatus = wantsDoubleOpt ? 'pending_confirmation' : 'subscribed';

    if (existing) {
        if (existing.status === 'subscribed') {
            return { status: 'subscribed' as const, already: true, };
        }
        await subs.setStatus(existing.id, targetStatus,);
        return { status: targetStatus, already: true, };
    }

    const confirmationToken = wantsDoubleOpt ? randomBytes(24,).toString('base64url',) : null;
    const created = await subs.create({
        listId: list.id,
        email,
        userId,
        name: input.name,
        phone: input.phone,
        customFields: input.customFields,
        status: targetStatus,
        confirmationToken,
    },);

    // Fire the double-opt-in confirmation email if needed. Failures don't
    // roll back the subscription — the operator can resend or force-confirm
    // from the admin UI.
    if (wantsDoubleOpt && confirmationToken) {
        try {
            const fe = (config.frontendUrl as string | undefined) ?? '';
            const confirmUrl = `${fe}/lists/${encodeURIComponent(list.slug,)}/confirm/${encodeURIComponent(confirmationToken,)}`;
            await sendEmail({
                to: email,
                subject: `Confirm your subscription to ${list.name}`,
                html: `
                    <h1>One more step</h1>
                    <p>Click the button below to confirm your subscription to <strong>${list.name}</strong>:</p>
                    <p style="text-align:center;padding:1rem 0">
                        <a href="${confirmUrl}" style="background:#3498cf;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Confirm subscription</a>
                    </p>
                    <p>Or copy and paste this URL into your browser:<br><code>${confirmUrl}</code></p>
                    <p>If you didn't subscribe, you can safely ignore this email.</p>
                `,
            },);
        } catch (mailErr) {
            // Log but don't fail the request. Operator gets a "Force
            // confirm" button in the admin UI for the pending row if the
            // email never lands.
            // eslint-disable-next-line no-console
            console.warn('Failed to send double-opt-in confirmation', mailErr,);
        }
    }

    return { status: created.status, id: created.id, };
}
