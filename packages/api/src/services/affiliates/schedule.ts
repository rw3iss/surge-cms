/**
 * Automatic payout schedule (pure). The daily cron asks `isPayoutDue`; a run
 * pays every affiliate with an available balance and stamps `lastAutoPayoutAt`.
 *
 *   weekly   — 7 days since the last run
 *   biweekly — 14 days since the last run
 *   monthly  — the first run in a new calendar month (UTC)
 *   off      — never (manual payouts only)
 *
 * The very first run (no last run) happens on the first daily check.
 */
import type { AffiliatePayoutSchedule, } from '@sitesurge/types';

const DAY = 86_400_000;

export function isPayoutDue(schedule: AffiliatePayoutSchedule, lastRunAt: string | Date | null | undefined, now: Date,): boolean {
    if (schedule === 'off') return false;
    if (!lastRunAt) return true;
    const last = new Date(lastRunAt,);
    if (Number.isNaN(last.getTime(),)) return true;
    // A little slack so a run that slipped a few minutes is not pushed a whole period.
    const slack = 2 * 3_600_000;
    if (schedule === 'weekly') return now.getTime() - last.getTime() >= 7 * DAY - slack;
    if (schedule === 'biweekly') return now.getTime() - last.getTime() >= 14 * DAY - slack;
    return now.getUTCFullYear() * 12 + now.getUTCMonth() > last.getUTCFullYear() * 12 + last.getUTCMonth();
}

/** When the next automatic payout is due (for display), or null when off. */
export function nextPayoutAt(schedule: AffiliatePayoutSchedule, lastRunAt: string | null | undefined, now: Date,): Date | null {
    if (schedule === 'off') return null;
    if (!lastRunAt) return now;
    const last = new Date(lastRunAt,);
    if (schedule === 'weekly') return new Date(last.getTime() + 7 * DAY,);
    if (schedule === 'biweekly') return new Date(last.getTime() + 14 * DAY,);
    return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1,),);
}
