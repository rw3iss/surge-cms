import { type Config, configParseFailed, getConfig, hasMinimalRunningConfig, loadConfig, } from './loader';

export { loadConfig, getConfig, hasMinimalRunningConfig, configParseFailed, };
export type { Config, };

/**
 * Backward-compatible `config` export. Previously a frozen const built
 * once at import time; now a Proxy that forwards every read to the
 * current snapshot via `getConfig()`. This is what makes future
 * in-process config reload (option B in the design) possible without
 * touching ~50 call sites.
 */
export const config: Config = new Proxy({} as Config, {
    get(_target, prop,) {
        return (getConfig() as unknown as Record<string | symbol, unknown>)[prop as string];
    },
    has(_target, prop,) {
        return prop in (getConfig() as unknown as object);
    },
    ownKeys() {
        return Reflect.ownKeys(getConfig() as unknown as object,);
    },
    getOwnPropertyDescriptor(_target, prop,) {
        return Object.getOwnPropertyDescriptor(getConfig() as unknown as object, prop,);
    },
},);
