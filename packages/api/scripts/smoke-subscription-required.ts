/**
 * Local smoke test for subscription-required mode (Users → Settings).
 * Turns it on, registers a member, checks the access state / gating / tier list
 * / open pages, then restores the setting and removes what it created.
 * Usage: npm run smoke:subscription-required   (dev DB with a paid tier)
 */
import { query, closePool, } from '../src/db';
import { cache, } from '../src/services/cache';
import * as settings from '../src/services/settings';
import { registerMember, } from '../src/services/auth';
import { accessState, } from '../src/services/subscriptionAccess';
import { viewerRank, } from '../src/services/postGate';
import { publicTiers, } from '../src/services/membership';

const ctx = { userId: undefined, ipAddress: '127.0.0.1', userAgent: 'smoke', } as never;
const assert = (c: unknown, m: string,) => { if (!c) throw new Error(`FAIL: ${m}`,); console.log(`ok  ${m}`,); };

async function main() {
    const before = await settings.getUsersSettings();
    const paid = (await query<{ id: string; sort_order: number; }>(
        `SELECT id, sort_order FROM subscription_plans WHERE is_free = false ORDER BY sort_order LIMIT 1`,
    )).rows[0];
    if (!paid) throw new Error('Needs a paid tier in the dev DB',);
    const email = `smoke-subreq-${Date.now()}@example.test`;
    let userId = '';
    let pageId = '';
    try {
        await settings.setUsersSettings({ ...before, requireSubscription: true, minimumTierId: null, requireEmailVerification: false, }, ctx,);

        const reg = await registerMember({ name: 'Sub Req', email, password: 'password123', }, { ipAddress: '127.0.0.1', },);
        userId = reg.userId;
        const a1 = await accessState({ id: userId, role: 'member', },);
        assert(a1.restricted && a1.reason === 'subscription' && !a1.lapsed, 'new member is restricted (needs a subscription)',);
        assert((await viewerRank({ id: userId, role: 'member', } as never,)) === null, 'free member passes no tier gate in this mode',);

        const tiers = await publicTiers(userId,);
        assert(tiers.subscriptionRequired && !tiers.tiers.some((t,) => t.isFree,), 'Free is hidden from the tier list',);

        await query(
            `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, 'active', NOW(), NOW() + interval '30 days')`,
            [userId, paid.id,],
        );
        const a2 = await accessState({ id: userId, role: 'member', },);
        assert(!a2.restricted && a2.subscribed, 'an active paid subscription lifts the restriction',);

        await query(`UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1`, [userId,],);
        const a3 = await accessState({ id: userId, role: 'member', },);
        assert(a3.restricted && a3.lapsed, 'a cancelled subscription → restricted again, flagged lapsed (renew)',);

        const staff = await accessState({ id: userId, role: 'admin', },);
        assert(!staff.restricted, 'staff are never restricted',);

        const page = await query<{ id: string; slug: string; }>(
            `INSERT INTO pages (slug, title, status, open_access) VALUES ($1, 'Open page', 'published', true) RETURNING id, slug`,
            [`smoke-open-${Date.now()}`,],
        );
        pageId = page.rows[0].id;
        await cache.invalidateSettingsCache();
        const pub = await settings.getPublicSettings();
        assert(pub.membership?.required && pub.membership.openPaths.includes(`/${page.rows[0].slug}`,), 'public settings expose the open pages',);

        await settings.setUsersSettings({ ...before, requireSubscription: false, }, ctx,);
        const off = await accessState({ id: userId, role: 'member', },);
        assert(!off.restricted && !off.subscriptionRequired, 'mode off → nobody restricted',);
    } finally {
        await settings.setUsersSettings(before, ctx,);
        if (pageId) await query(`DELETE FROM pages WHERE id = $1`, [pageId,],);
        if (userId) {
            await query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId,],);
            await query(`DELETE FROM users WHERE id = $1`, [userId,],);
        }
        await cache.invalidateSettingsCache();
    }
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
