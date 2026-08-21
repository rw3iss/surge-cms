/**
 * Events & calendar service — the public face of the `events` feature.
 *
 * This file is a BARREL. The implementation lives in `services/events/`, split
 * by responsibility so each part can be read and tested on its own:
 *
 * | Module             | Owns                                                  |
 * |--------------------|-------------------------------------------------------|
 * | `settings.ts`      | Site-level events settings + calendar URL validation   |
 * | `crud.ts`          | Event records: list, read, create, update, delete      |
 * | `calendar.ts`      | Occurrence-expanded reads + per-date overrides         |
 * | `occurrences.ts`   | The DB seam onto the pure recurrence engine            |
 * | `subscriptions.ts` | Who signs up to HEAR about events (email + push)       |
 * | `notifications.ts` | Sending those notifications + the reminder sweep       |
 * | `registration.ts`  | Attendees: who is actually coming                      |
 * | `tiers.ts`         | Ticket tier definitions + live availability            |
 * | `tickets.ts`       | Pricing lines from the DB and issuing ticket codes     |
 * | `purchase.ts`      | Checkout: free → issue now, paid → hand to Stripe      |
 *
 * Dependencies run one way — `crud → notifications → settings`, and
 * `subscriptions → crud` — which is why sign-up and send-out are separate
 * modules rather than the one "notifications" file they started as.
 *
 * Re-exporting here keeps `import * as events from '../services/events'`
 * working unchanged for every caller.
 */

export {
    getPublicSettings,
    getSettings,
    SETTINGS_KEY,
    updateSettings,
} from './events/settings';

export {
    create,
    getByIdOrSlug,
    list,
    normalizeRegistrationFields,
    remove,
    update,
} from './events/crud';
export type { ListOpts, } from './events/crud';

export { listOccurrences, setOccurrenceStatus, } from './events/calendar';

export {
    registerPushEndpoint,
    subscribe,
    unsubscribe,
} from './events/subscriptions';

export { notifyForEvent, runReminderSweep, } from './events/notifications';
export type { NotifyKind, } from './events/notifications';

export {
    defaultOccurrenceDate,
    listRegistrations,
    register,
    registrantCount,
} from './events/registration';

export { listTiers, replaceTiers, } from './events/tiers';

export { purchaseTickets, sendTicketConfirmation, } from './events/purchase';
export type { PurchaseResult, } from './events/purchase';

export type { CalendarEvent, EventStatus, } from '@sitesurge/types';
