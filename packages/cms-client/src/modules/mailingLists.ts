import type {
    MailingListListResponse, MailingListGetResponse, MailingListCreateBody, MailingListCreateResponse,
    MailingListUpdateBody, MailingListUpdateResponse, MailingListDeleteResponse,
    MailingListSubscribersQuery, MailingListSubscribersResponse,
    MailingListSubscriberCreateBody, MailingListSubscriberCreateResponse,
    MailingListSubscriberUpdateBody, MailingListSubscriberUpdateResponse,
    MailingListSubscriberDeleteResponse, MailingListSubscribersBulkDeleteBody,
    MailingListSubscribersBulkDeleteResponse, MailingListSubscriberForceConfirmResponse,
    ListSubscribeBody, ListSubscribeResponse, ListSubscriptionStatusResponse,
    MailScheduleListResponse, MailScheduleGetResponse, MailScheduleCreateBody,
    MailScheduleCreateResponse, MailScheduleUpdateBody, MailScheduleUpdateResponse,
    MailScheduleSetEnabledResponse, MailScheduleDeleteResponse, MailScheduleTimezoneResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * mailingLists namespace — DUAL MOUNT under one handle. Admin CRUD +
 * subscriber management live at `/mailing-lists/*`; the single PUBLIC
 * subscribe endpoint lives at `/lists/:slug/subscribe` (literal `/lists`
 * path, NOT `/mailing-lists`). The cache `module` identity is
 * 'mailingLists' for both; mutations invalidate the whole module.
 */
export class MailingListsModule extends ModuleBase {
    protected readonly module = 'mailingLists';

    /** GET /mailing-lists — all lists with subscriberCount (admin). */
    list(): Promise<MailingListListResponse> {
        return this.get<MailingListListResponse>('/mailing-lists',);
    }

    /** GET /mailing-lists/:id (admin). */
    getById(id: string,): Promise<MailingListGetResponse> {
        return this.get<MailingListGetResponse>('/mailing-lists/:id', { params: { id, }, },);
    }

    /** POST /mailing-lists — create a list (admin). */
    create(body: MailingListCreateBody,): Promise<MailingListCreateResponse> {
        return this.mutate<MailingListCreateResponse>('POST', '/mailing-lists', { body, invalidates: ['mailingLists',], },);
    }

    /** PUT /mailing-lists/:id — update a list (admin). */
    update(id: string, body: MailingListUpdateBody,): Promise<MailingListUpdateResponse> {
        return this.mutate<MailingListUpdateResponse>('PUT', '/mailing-lists/:id', { params: { id, }, body, invalidates: ['mailingLists',], },);
    }

    /** DELETE /mailing-lists/:id (admin). */
    remove(id: string,): Promise<MailingListDeleteResponse> {
        return this.mutate<MailingListDeleteResponse>('DELETE', '/mailing-lists/:id', { params: { id, }, invalidates: ['mailingLists',], },);
    }

    /** GET /mailing-lists/:id/subscribers — `{ items, total }` wrapper
     *  (NON-STANDARD: paging lives inside data, not on meta). */
    subscribers(listId: string, query?: MailingListSubscribersQuery,): Promise<MailingListSubscribersResponse> {
        return this.get<MailingListSubscribersResponse>('/mailing-lists/:id/subscribers', { params: { id: listId, }, query: query as Record<string, unknown>, },);
    }

    /** POST /mailing-lists/:id/subscribers — add (force-confirmed; idempotent). */
    addSubscriber(listId: string, body: MailingListSubscriberCreateBody,): Promise<MailingListSubscriberCreateResponse> {
        return this.mutate<MailingListSubscriberCreateResponse>('POST', '/mailing-lists/:id/subscribers', { params: { id: listId, }, body, invalidates: ['mailingLists',], },);
    }

    /** PUT /mailing-lists/:id/subscribers/:subId — edit a subscriber. */
    updateSubscriber(listId: string, subId: string, body: MailingListSubscriberUpdateBody,): Promise<MailingListSubscriberUpdateResponse> {
        return this.mutate<MailingListSubscriberUpdateResponse>('PUT', '/mailing-lists/:id/subscribers/:subId', { params: { id: listId, subId, }, body, invalidates: ['mailingLists',], },);
    }

    /** DELETE /mailing-lists/:id/subscribers/:subId. */
    removeSubscriber(listId: string, subId: string,): Promise<MailingListSubscriberDeleteResponse> {
        return this.mutate<MailingListSubscriberDeleteResponse>('DELETE', '/mailing-lists/:id/subscribers/:subId', { params: { id: listId, subId, }, invalidates: ['mailingLists',], },);
    }

    /** POST /mailing-lists/:id/subscribers/bulk-delete — count removed. */
    bulkDeleteSubscribers(listId: string, body: MailingListSubscribersBulkDeleteBody,): Promise<MailingListSubscribersBulkDeleteResponse> {
        return this.mutate<MailingListSubscribersBulkDeleteResponse>('POST', '/mailing-lists/:id/subscribers/bulk-delete', { params: { id: listId, }, body, invalidates: ['mailingLists',], },);
    }

    /** POST /mailing-lists/:id/subscribers/:subId/force-confirm — pending → subscribed. */
    forceConfirmSubscriber(listId: string, subId: string,): Promise<MailingListSubscriberForceConfirmResponse> {
        return this.mutate<MailingListSubscriberForceConfirmResponse>('POST', '/mailing-lists/:id/subscribers/:subId/force-confirm', { params: { id: listId, subId, }, invalidates: ['mailingLists',], },);
    }

    /** PUBLIC — POST /lists/:slug/subscribe. Literal `/lists` path (NOT
     *  `/mailing-lists`); double-opt-in-aware union response. */
    subscribe(slug: string, body: ListSubscribeBody,): Promise<ListSubscribeResponse> {
        return this.mutate<ListSubscribeResponse>('POST', '/lists/:slug/subscribe', { params: { slug, }, body, invalidates: ['mailingLists',], },);
    }

    /** PUBLIC — GET /lists/:slug/subscription. "Am I on this list?" for the
     *  SIGNED-IN caller only; takes no email and answers `false` when
     *  anonymous, so it cannot be used to test someone else's membership. */
    subscriptionStatus(slug: string,): Promise<ListSubscriptionStatusResponse> {
        return this.get<ListSubscriptionStatusResponse>('/lists/:slug/subscription', { params: { slug, }, },);
    }

    // ─── Scheduled sends (/mail-schedules) ────────────────────────────
    //
    // Same module handle: a schedule is a mailing-list concept, and sharing
    // the cache identity means creating one invalidates the list view that
    // shows it.

    /** GET /mail-schedules — every scheduled send. */
    schedules(): Promise<MailScheduleListResponse> {
        return this.get<MailScheduleListResponse>('/mail-schedules',);
    }

    /** GET /mail-schedules/:id */
    schedule(id: string,): Promise<MailScheduleGetResponse> {
        return this.get<MailScheduleGetResponse>('/mail-schedules/:id', { params: { id, }, },);
    }

    /** GET /mail-schedules/timezone — the site's authoring zone, for form defaults. */
    scheduleTimezone(): Promise<MailScheduleTimezoneResponse> {
        return this.get<MailScheduleTimezoneResponse>('/mail-schedules/timezone',);
    }

    /** POST /mail-schedules */
    createSchedule(body: MailScheduleCreateBody,): Promise<MailScheduleCreateResponse> {
        return this.mutate<MailScheduleCreateResponse>('POST', '/mail-schedules', { body, invalidates: ['mailingLists',], },);
    }

    /** PUT /mail-schedules/:id */
    updateSchedule(id: string, body: MailScheduleUpdateBody,): Promise<MailScheduleUpdateResponse> {
        return this.mutate<MailScheduleUpdateResponse>('PUT', '/mail-schedules/:id', { params: { id, }, body, invalidates: ['mailingLists',], },);
    }

    /** PATCH /mail-schedules/:id/enabled — pause or resume. */
    setScheduleEnabled(id: string, enabled: boolean,): Promise<MailScheduleSetEnabledResponse> {
        return this.mutate<MailScheduleSetEnabledResponse>('PATCH', '/mail-schedules/:id/enabled', { params: { id, }, body: { enabled, }, invalidates: ['mailingLists',], },);
    }

    /** DELETE /mail-schedules/:id */
    deleteSchedule(id: string,): Promise<MailScheduleDeleteResponse> {
        return this.mutate<MailScheduleDeleteResponse>('DELETE', '/mail-schedules/:id', { params: { id, }, invalidates: ['mailingLists',], },);
    }
}
