import type {
    MailingListListResponse, MailingListGetResponse, MailingListCreateBody, MailingListCreateResponse,
    MailingListUpdateBody, MailingListUpdateResponse, MailingListDeleteResponse,
    MailingListSubscribersQuery, MailingListSubscribersResponse,
    MailingListSubscriberCreateBody, MailingListSubscriberCreateResponse,
    MailingListSubscriberUpdateBody, MailingListSubscriberUpdateResponse,
    MailingListSubscriberDeleteResponse, MailingListSubscribersBulkDeleteBody,
    MailingListSubscribersBulkDeleteResponse, MailingListSubscriberForceConfirmResponse,
    ListSubscribeBody, ListSubscribeResponse,
} from '@rw/cms-shared';
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
}
