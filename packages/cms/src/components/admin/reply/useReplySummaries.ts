/**
 * Reply counts / last status for the records on screen — one request per page
 * of rows (`GET /replies/:source/summary?ids=`). Call `refetch()` after a send
 * so the row's status updates.
 */
import { createResource, } from 'solid-js';
import type { ReplySourceKey, ReplySummary, ReplySummaryResponse, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';

export function useReplySummaries(source: ReplySourceKey, ids: () => string[],) {
    const [summaries, { refetch, },] = createResource(
        () => ids().filter(Boolean,).join(',',),
        (key,) => key
            ? cms.replies.summary(source, key.split(',',),).catch(() => ({}) as ReplySummaryResponse)
            : Promise.resolve({} as ReplySummaryResponse),
    );
    return {
        get: (id: string,): ReplySummary | null => summaries()?.[id] ?? null,
        refetch: () => void refetch(),
    };
}
