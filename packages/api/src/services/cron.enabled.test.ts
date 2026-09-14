/**
 * CRON_ENABLED=false must make an instance INERT, not merely quiet.
 *
 * This exists because a warm standby is a real deployment: two instances point
 * at the same Printify shop, the same SMTP account, the same Stripe keys.
 * Serving traffic twice is harmless; ACTING twice is not — the standby will
 * resubmit orders and send mail that the primary has already handled.
 *
 * The gate is on scheduleJob rather than startAll on purpose, and that is what
 * these pin: `registerAndStart` schedules directly, so a feature switched on at
 * runtime (or a social provider connecting) would otherwise start a live job on
 * a box that is supposed to be doing nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';

const scheduled: string[] = [];

vi.mock('node-cron', () => ({
    default: {
        validate: () => true,
        schedule: (expr: string,) => { scheduled.push(expr,); return { stop: () => {}, }; },
    },
}),);
vi.mock('cron-parser', () => ({ CronExpressionParser: { parse: () => ({ next: () => new Date(), }), }, }),);
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, }, }),);

let cronEnabled = true;
vi.mock('../config', () => ({ config: { get cronEnabled() { return cronEnabled; }, }, }),);

async function freshRegistry() {
    vi.resetModules();
    const mod = await import('./cron');
    return mod.cronRegistry;
}

beforeEach(() => { scheduled.length = 0; cronEnabled = true; },);
afterEach(() => { vi.resetModules(); },);

describe('CRON_ENABLED', () => {
    it('schedules jobs when enabled', async () => {
        const r = await freshRegistry();
        r.register({ name: 'a', schedule: '* * * * *', handler: async () => {}, } as never,);
        r.startAll();
        expect(scheduled,).toEqual(['* * * * *',],);
    },);

    it('registers but does not schedule when disabled', async () => {
        cronEnabled = false;
        const r = await freshRegistry();
        r.register({ name: 'a', schedule: '* * * * *', handler: async () => {}, } as never,);
        r.startAll();
        expect(scheduled,).toEqual([],);
        // Still REGISTERED — the admin's job list should show what would run.
        expect(r.list().length,).toBe(1,);
    },);

    it('blocks registerAndStart too, not just startAll', async () => {
        cronEnabled = false;
        const r = await freshRegistry();
        // The runtime path: a feature enabled after boot schedules immediately.
        r.registerAndStart({ name: 'late', schedule: '*/5 * * * *', handler: async () => {}, } as never,);
        expect(scheduled,).toEqual([],);
    },);
},);
