/**
 * The public event list's two sections: PAST (finished — newest first) and
 * UPCOMING (not over yet — soonest first; an event in progress is upcoming).
 * "Over" = its end, else its start, is before `now`.
 */
import type { EventOccurrence, } from '@sitesurge/types';

export interface EventSections {
    past: EventOccurrence[];
    upcoming: EventOccurrence[];
}

export function splitEventSections(occurrences: readonly EventOccurrence[], now: number = Date.now(),): EventSections {
    const over = (o: EventOccurrence,) => Date.parse(o.endsAt ?? o.startsAt,) < now;
    const start = (o: EventOccurrence,) => Date.parse(o.startsAt,);
    return {
        past: occurrences.filter(over,).sort((a, b,) => start(b,) - start(a,)),
        upcoming: occurrences.filter((o,) => !over(o,)).sort((a, b,) => start(a,) - start(b,)),
    };
}
