import { Accessor, createEffect, createSignal, on, onCleanup, } from 'solid-js';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveOptions<T,> {
    /** Unique key for this draft (e.g. `post-draft-123` or `post-draft-new`) */
    key: string;
    /** Accessor for the current state to persist */
    state: Accessor<T>;
    /** Debounce delay in ms (default 1500) */
    delay?: number;
    /** Whether to enable auto-save — defaults to true */
    enabled?: () => boolean;
}

export interface AutoSaveDraft<T,> {
    timestamp: number;
    data: T;
}

const PREFIX = 'surge-draft:';

/**
 * Debounced draft auto-save to localStorage.
 * Writes the current state under `surge-draft:{key}` whenever it changes.
 *
 * Usage:
 *   const state = () => ({ title: title(), blocks: blocks() });
 *   const { status, restore, clear, hasDraft } = useAutoSave({ key: `post-draft-${id}`, state });
 */
export function useAutoSave<T,>(opts: UseAutoSaveOptions<T>,) {
    const [status, setStatus,] = createSignal<AutoSaveStatus>('idle',);
    const [lastSavedAt, setLastSavedAt,] = createSignal<number | null>(null,);
    const delay = opts.delay ?? 1500;
    const storageKey = () => PREFIX + opts.key;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let isFirst = true;

    const persist = () => {
        try {
            const payload: AutoSaveDraft<T> = {
                timestamp: Date.now(),
                data: opts.state(),
            };
            localStorage.setItem(storageKey(), JSON.stringify(payload,),);
            setLastSavedAt(payload.timestamp,);
            setStatus('saved',);
        } catch (err) {
            console.warn('[useAutoSave] failed to persist draft', err,);
            setStatus('error',);
        }
    };

    createEffect(on(opts.state, () => {
        if (isFirst) {
            isFirst = false;
            return;
        }
        if (opts.enabled && !opts.enabled()) return;
        setStatus('saving',);
        if (timer) clearTimeout(timer,);
        timer = setTimeout(persist, delay,);
    }, { defer: true, },),);

    onCleanup(() => {
        if (timer) clearTimeout(timer,);
    },);

    /** Read the persisted draft (if any) */
    const getDraft = (): AutoSaveDraft<T> | null => {
        try {
            const raw = localStorage.getItem(storageKey(),);
            if (!raw) return null;
            return JSON.parse(raw,) as AutoSaveDraft<T>;
        } catch {
            return null;
        }
    };

    /** True if a draft exists in storage */
    const hasDraft = (): boolean => !!getDraft();

    /** Remove the persisted draft */
    const clear = () => {
        try {
            localStorage.removeItem(storageKey(),);
            setLastSavedAt(null,);
            setStatus('idle',);
        } catch {
            /* ignore */
        }
    };

    /** Force-save immediately (flush pending debounced write) */
    const flush = () => {
        if (timer) {
            clearTimeout(timer,);
            timer = null;
        }
        persist();
    };

    return {
        status,
        lastSavedAt,
        getDraft,
        hasDraft,
        clear,
        flush,
    };
}
