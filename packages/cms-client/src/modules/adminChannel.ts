import type { AdminChannelPresenceResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * `/admin-channel` namespace (staff) — a REST snapshot of who is currently
 * connected to the admin. Live presence flows over the WebSocket at
 * `/ws/admin`; this is the fallback / initial fetch.
 */
export class AdminChannelModule extends ModuleBase {
    protected readonly module = 'admin-channel';

    /** GET /admin-channel/presence — connected users + configured idle timeout. */
    presence(): Promise<AdminChannelPresenceResponse> {
        return this.get<AdminChannelPresenceResponse>('/admin-channel/presence', { options: { cache: false, }, },);
    }
}
