/**
 * `cms.ui` — small UI preferences kept in THIS browser (localStorage), not on
 * the server: a dismissed banner, a collapsed panel, a chosen view. One JSON
 * object per client namespace (`<namespace>.uiSettings`), so every caller —
 * the SPA and component scripts (`ctx.cms.ui`) alike — reads and writes the
 * same store instead of each inventing its own key.
 *
 * Falls back to memory where localStorage is unavailable (SSR, Safari
 * private mode, storage blocked): settings then last for the page only, and
 * nothing throws.
 */
import type { CmsClientCore, } from '../core/client';

export class UiSettingsModule {
    private memory: Record<string, unknown> = {};
    private readonly key: string;

    constructor(core: CmsClientCore,) {
        this.key = `${core.config.namespace}.uiSettings`;
    }

    private read(): Record<string, unknown> {
        try {
            if (typeof localStorage === 'undefined') return this.memory;
            const raw = localStorage.getItem(this.key,);
            return raw ? (JSON.parse(raw,) as Record<string, unknown>) ?? {} : {};
        } catch {
            return this.memory;
        }
    }

    private write(all: Record<string, unknown>,): void {
        this.memory = all;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(this.key, JSON.stringify(all,),);
        } catch { /* storage unavailable — the memory copy still works for this page */ }
    }

    /** The stored value for `name`, or `fallback`. */
    get<T = unknown,>(name: string, fallback?: T,): T | undefined {
        const all = this.read();
        return (name in all ? all[name] : fallback) as T | undefined;
    }

    /** Store a JSON-serialisable value. */
    set(name: string, value: unknown,): void {
        this.write({ ...this.read(), [name]: value, },);
    }

    /** Shallow-merge an object value (e.g. `{ dismissedAt }` into a component's record). */
    merge<T extends Record<string, unknown>,>(name: string, patch: Partial<T>,): T {
        const cur = this.get<T>(name,) ?? {} as T;
        const next = { ...cur, ...patch, } as T;
        this.set(name, next,);
        return next;
    }

    remove(name: string,): void {
        const all = { ...this.read(), };
        delete all[name];
        this.write(all,);
    }

    /** Every stored setting (a copy). */
    all(): Record<string, unknown> {
        return { ...this.read(), };
    }
}
