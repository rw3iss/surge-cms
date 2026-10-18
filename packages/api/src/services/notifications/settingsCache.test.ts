import { afterEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn(async () => ({ rows: [{ value: { user_signup: { email: { enabled: true, addresses: ['a@x.co',], }, }, }, },], }),);
vi.mock('../../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
vi.mock('./channels', () => ({ CHANNELS: {}, }),);

import { getNotificationSettings, NOTIFICATION_SETTINGS_TTL_MS, } from './index';

afterEach(() => vi.useRealTimers(),);

describe('notification settings cache', () => {
    it('re-reads after the TTL so other workers pick up a change', async () => {
        vi.useFakeTimers();
        await getNotificationSettings();
        await getNotificationSettings();
        expect(q,).toHaveBeenCalledTimes(1,);
        vi.advanceTimersByTime(NOTIFICATION_SETTINGS_TTL_MS + 1,);
        await getNotificationSettings();
        expect(q,).toHaveBeenCalledTimes(2,);
    },);
},);
