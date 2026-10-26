import { describe, expect, it, } from 'vitest';
import { isPayoutDue, nextPayoutAt, } from './schedule';

const at = (s: string,) => new Date(s,);

describe('isPayoutDue', () => {
    it('never when off', () => expect(isPayoutDue('off', null, at('2026-10-26T06:15:00Z',),),).toBe(false,),);
    it('the first run happens at once', () => expect(isPayoutDue('weekly', null, at('2026-10-26T06:15:00Z',),),).toBe(true,),);
    it('weekly after 7 days (with a little slack)', () => {
        const last = '2026-10-19T06:15:00Z';
        expect(isPayoutDue('weekly', last, at('2026-10-25T06:15:00Z',),),).toBe(false,);
        expect(isPayoutDue('weekly', last, at('2026-10-26T05:30:00Z',),),).toBe(true,);
        expect(isPayoutDue('weekly', last, at('2026-10-26T06:15:00Z',),),).toBe(true,);
    },);
    it('biweekly after 14 days', () => {
        const last = '2026-10-12T06:15:00Z';
        expect(isPayoutDue('biweekly', last, at('2026-10-19T06:15:00Z',),),).toBe(false,);
        expect(isPayoutDue('biweekly', last, at('2026-10-26T06:15:00Z',),),).toBe(true,);
    },);
    it('monthly on the first run of a new month', () => {
        const last = '2026-10-01T06:15:00Z';
        expect(isPayoutDue('monthly', last, at('2026-10-31T06:15:00Z',),),).toBe(false,);
        expect(isPayoutDue('monthly', last, at('2026-11-01T06:15:00Z',),),).toBe(true,);
        expect(isPayoutDue('monthly', '2026-12-15T06:15:00Z', at('2027-01-01T06:15:00Z',),),).toBe(true,);
    },);
},);

describe('nextPayoutAt', () => {
    it('shows the next date', () => {
        expect(nextPayoutAt('off', null, at('2026-10-26T00:00:00Z',),),).toBeNull();
        expect(nextPayoutAt('weekly', '2026-10-19T06:15:00Z', at('2026-10-26T00:00:00Z',),)?.toISOString(),).toBe('2026-10-26T06:15:00.000Z',);
        expect(nextPayoutAt('monthly', '2026-10-01T06:15:00Z', at('2026-10-26T00:00:00Z',),)?.toISOString(),).toBe('2026-11-01T00:00:00.000Z',);
    },);
},);
