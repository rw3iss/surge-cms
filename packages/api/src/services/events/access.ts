/**
 * Event access: who may SEE an event and who may REGISTER / get tickets, and
 * which ticket types need a subscription. Levels come from the shared rule
 * (services/access/level.ts): anonymous -1, signed in 0, subscriber = tier
 * rank, staff ∞. An event's `inherit` takes Settings → Events.
 *
 * Registering is never looser than viewing (you cannot register for what you
 * cannot see), so the effective register floor is max(view, register).
 */
import type { CalendarEvent, EventAccess, EventAccessOverride, EventTicketTier, EventViewerAccess, EventsSettings, } from '@sitesurge/types';
import { AccessRequiredError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { floorFor, refusalReason, tierInfo, viewerLevel, type LevelViewer, } from '../access/level';
import { tiersById, } from '../postGate';
import { getSettings, } from './settings';

type Rules = Pick<CalendarEvent, 'viewAccess' | 'viewMinTierId' | 'registerAccess' | 'registerMinTierId'>;

function resolveRule(own: EventAccessOverride | undefined, ownTier: string | null | undefined, globalRule: EventAccess, globalTier: string | null,) {
    return !own || own === 'inherit' ? { rule: globalRule, tierId: globalTier, } : { rule: own, tierId: ownTier ?? null, };
}

/** The event's view + register floors (levels) and the tier registration needs. */
export async function eventFloors(e: Rules, s?: EventsSettings,): Promise<{ view: number; register: number; registerTierId: string | null; }> {
    const st = s ?? (await getSettings());
    const v = resolveRule(e.viewAccess, e.viewMinTierId, st.viewAccess ?? 'public', st.viewMinTierId ?? null,);
    const r = resolveRule(e.registerAccess, e.registerMinTierId, st.registerAccess ?? 'public', st.registerMinTierId ?? null,);
    const view = await floorFor(v.rule, v.tierId,);
    const reg = await floorFor(r.rule, r.tierId,);
    // The stricter of the two decides who may register — and names its tier.
    const registerTierId = reg >= view ? (r.rule === 'tier' ? r.tierId : null) : (v.rule === 'tier' ? v.tierId : null);
    return { view, register: Math.max(view, reg,), registerTierId, };
}

/** What a viewer may do with this event. */
export async function accessFor(e: Rules, viewer: LevelViewer, s?: EventsSettings,): Promise<EventViewerAccess> {
    const [level, f,] = await Promise.all([viewerLevel(viewer,), eventFloors(e, s,),],);
    return {
        canView: level >= f.view,
        canRegister: level >= f.register,
        registerReason: refusalReason(level, f.register,),
        requiredTier: await tierInfo(f.registerTierId,),
    };
}

/** Throws a sign-in / subscribe error when the viewer may not see the event. */
export async function assertCanView(e: Rules, viewer: LevelViewer,): Promise<void> {
    const s = await getSettings();
    const [level, f,] = await Promise.all([viewerLevel(viewer,), eventFloors(e, s,),],);
    if (level >= f.view) return;
    const v = resolveRule(e.viewAccess, e.viewMinTierId, s.viewAccess ?? 'public', s.viewMinTierId ?? null,);
    const tier = v.rule === 'tier' ? await tierInfo(v.tierId,) : null;
    throw new AccessRequiredError(refusalReason(level, f.view,) ?? 'subscribe', tier,
        level < 0 && f.view <= 0 ? 'Please sign in to see this event.' : `This event requires ${tier ? `the ${tier.name} subscription or higher` : 'a subscription'}.`,);
}

/** Throws a sign-in / subscribe error when the viewer may not register. */
export async function assertCanRegister(e: Rules & { title?: string; }, viewer: LevelViewer,): Promise<void> {
    const a = await accessFor(e, viewer,);
    if (a.canRegister) return;
    const what = e.title ? `"${e.title}"` : 'this event';
    throw new AccessRequiredError(
        a.registerReason ?? 'subscribe',
        a.requiredTier,
        a.registerReason === 'signin'
            ? `Please sign in to register for ${what}.`
            : `Registering for ${what} requires ${a.requiredTier ? `the ${a.requiredTier.name} subscription or higher` : 'a subscription'}.`,
    );
}

/** May a viewer at `level` buy this ticket type? */
export async function tierFloor(tier: Pick<EventTicketTier, 'requiredTierId'>,): Promise<number> {
    return tier.requiredTierId ? floorFor('tier', tier.requiredTierId,) : -1;
}

export async function assertCanBuyTier(tier: Pick<EventTicketTier, 'requiredTierId' | 'name'>, viewer: LevelViewer,): Promise<void> {
    if (!tier.requiredTierId) return;
    const [level, floor,] = await Promise.all([viewerLevel(viewer,), tierFloor(tier,),],);
    if (level >= floor) return;
    const required = await tierInfo(tier.requiredTierId,);
    throw new AccessRequiredError(
        level < 0 ? 'signin' : 'subscribe',
        required,
        `The "${tier.name}" ticket requires ${required ? `the ${required.name} subscription or higher` : 'a subscription'}${level < 0 ? ' — sign in first' : ''}.`,
    );
}

/** Attach `requiredTier` + `canBuy` for the viewer to each tier. */
export async function decorateTiers<T extends EventTicketTier,>(tiers: T[], viewer: LevelViewer,): Promise<T[]> {
    const level = await viewerLevel(viewer,);
    return Promise.all(tiers.map(async (t,) => ({
        ...t,
        requiredTier: await tierInfo(t.requiredTierId,),
        canBuy: level >= (await tierFloor(t,)),
    })),);
}

/** Keep only events the viewer may see (staff see all). */
export async function filterViewable<T extends Rules,>(events: T[], viewer: LevelViewer,): Promise<T[]> {
    if (!events.length) return events;
    const [level, s,] = await Promise.all([viewerLevel(viewer,), getSettings(),],);
    if (level === Infinity) return events;
    const out: T[] = [];
    for (const e of events) if (level >= (await eventFloors(e, s,)).view) out.push(e,);
    return out;
}

/** Validate an access rule pair on write (a `tier` rule needs a real tier). */
export async function assertRule(rule: EventAccessOverride | EventAccess | undefined, tierId: string | null | undefined, label: string,): Promise<void> {
    if (rule === undefined) return;
    if (!['inherit', 'public', 'members', 'tier',].includes(rule,)) throw new ValidationError(`Unknown ${label} rule.`,);
    if (rule === 'tier' && (!tierId || !(await tiersById()).has(tierId,))) throw new ValidationError(`Choose the subscription tier for ${label}.`,);
}

/** Tier ids that exist (for ticket tier validation). */
export async function assertTierIds(ids: (string | null | undefined)[],): Promise<void> {
    const want = ids.filter(Boolean,) as string[];
    if (!want.length) return;
    const r = await query<{ id: string; }>(`SELECT id FROM subscription_plans WHERE id = ANY($1::uuid[])`, [want,],);
    if (r.rows.length !== new Set(want,).size) throw new ValidationError('A ticket type requires a subscription tier that no longer exists.',);
}
