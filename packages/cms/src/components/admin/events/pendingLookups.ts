/**
 * Tracks map lookups still running in the event Location field, so Save can
 * wait for them: a changed address is searched on blur, and the click on Save
 * IS that blur — without waiting, the old point would be saved with the new
 * address. Framework-free (the count is reported through `onChange`).
 */
export interface PendingLookups {
    /** Track a lookup; returns it unchanged. */
    track<T>(p: Promise<T>,): Promise<T>;
    /** Lookups still running. */
    count(): number;
    /** Resolves once none run (or after `maxMs`, whichever is first). Never rejects. */
    settled(maxMs?: number,): Promise<void>;
}

export function createPendingLookups(onChange?: (count: number,) => void,): PendingLookups {
    const running = new Set<Promise<unknown>>();
    const changed = () => onChange?.(running.size,);
    return {
        track(p,) {
            const tracked: Promise<unknown> = p.then(() => undefined, () => undefined,).finally(() => {
                running.delete(tracked,);
                changed();
            },);
            running.add(tracked,);
            changed();
            return p;
        },
        count: () => running.size,
        async settled(maxMs = 10_000,) {
            const deadline = Date.now() + maxMs;
            // A lookup may start while another finishes (search → next search): loop until none run.
            while (running.size) {
                const left = deadline - Date.now();
                if (left <= 0) return;
                let timer: ReturnType<typeof setTimeout> | undefined;
                await Promise.race([
                    Promise.all([...running,],),
                    new Promise<void>((r,) => { timer = setTimeout(r, left,); },),
                ],);
                if (timer) clearTimeout(timer,);
            }
        },
    };
}
