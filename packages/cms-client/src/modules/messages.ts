import type {
    MessageSubmitBody, MessageSubmitResponse, MessageListQuery, MessageListResponse,
    MessageByIdResponse, MessageStatusUpdateBody, MessageStatusUpdateResponse,
    MessageDeleteResponse, MessageBulkBody, MessageBulkResponse,
    MessageBulkStatusBody, MessageBulkStatusResponse,
    MessageBulkDeleteBody, MessageBulkDeleteResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /messages namespace — public contact-form submit + admin inbox. */
export class MessagesModule extends ModuleBase {
    protected readonly module = 'messages';

    /** POST /messages — public contact-form submission (server adds ip/ua/userId). */
    submit(body: MessageSubmitBody,): Promise<MessageSubmitResponse> {
        return this.mutate<MessageSubmitResponse>('POST', '/messages', { body, invalidates: ['messages',], },);
    }

    /** GET /messages — paginated admin list with status/search filters. */
    list(query?: MessageListQuery,): Promise<Paginated<MessageListResponse[number]>> {
        return this.getPaged<MessageListResponse[number]>('/messages', { query: query as Record<string, unknown>, },);
    }

    /** GET /messages/:id — fetching marks unread → read. */
    getById(id: string,): Promise<MessageByIdResponse> {
        return this.get<MessageByIdResponse>('/messages/:id', { params: { id, }, },);
    }

    /** PUT /messages/:id/status — update one message's status. */
    updateStatus(id: string, body: MessageStatusUpdateBody,): Promise<MessageStatusUpdateResponse> {
        return this.mutate<MessageStatusUpdateResponse>('PUT', '/messages/:id/status', { params: { id, }, body, invalidates: ['messages',], },);
    }

    remove(id: string,): Promise<MessageDeleteResponse> {
        return this.mutate<MessageDeleteResponse>('DELETE', '/messages/:id', { params: { id, }, invalidates: ['messages',], },);
    }

    /** POST /messages/bulk — unified runner (action='delete'|'status'). */
    bulk(body: MessageBulkBody,): Promise<MessageBulkResponse> {
        return this.mutate<MessageBulkResponse>('POST', '/messages/bulk', { body, invalidates: ['messages',], },);
    }

    /** POST /messages/bulk-status — legacy bulk status (redundant with bulk). */
    bulkStatus(body: MessageBulkStatusBody,): Promise<MessageBulkStatusResponse> {
        return this.mutate<MessageBulkStatusResponse>('POST', '/messages/bulk-status', { body, invalidates: ['messages',], },);
    }

    /** POST /messages/bulk-delete — legacy bulk delete (redundant with bulk). */
    bulkDelete(body: MessageBulkDeleteBody,): Promise<MessageBulkDeleteResponse> {
        return this.mutate<MessageBulkDeleteResponse>('POST', '/messages/bulk-delete', { body, invalidates: ['messages',], },);
    }
}
