import type { DevCronListResponse, DevCronGetResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /dev namespace (admin) — developer tools: cron registry inspection. */
export class DevModule extends ModuleBase {
    protected readonly module = 'dev';

    /** GET /dev/crons — all registered cron jobs. */
    listCrons(): Promise<DevCronListResponse> {
        return this.get<DevCronListResponse>('/dev/crons',);
    }

    /** GET /dev/crons/:name — one job, or null when unknown. */
    getCron(name: string,): Promise<DevCronGetResponse> {
        return this.get<DevCronGetResponse>('/dev/crons/:name', { params: { name, }, },);
    }
}
