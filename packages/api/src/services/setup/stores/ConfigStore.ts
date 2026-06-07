/**
 * Generic key/value config store. Two impls today (`envFileStore`,
 * `dbSettingsStore`) so installer code can write either layer through
 * the same interface and tests can swap in an in-memory mock.
 */
export interface ConfigStore {
    get(key: string,): Promise<string | undefined>;
    set(key: string, value: string,): Promise<void>;
    setMany(entries: Record<string, string>,): Promise<void>;
    has(key: string,): Promise<boolean>;
}
