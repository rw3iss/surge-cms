/**
 * nanoid interop shim.
 *
 * nanoid v5 is ESM-only. This API package compiles to CommonJS, and Node's
 * `require(esm)` (Node ≥ 20.19 / 22.12) already loads it at runtime — but TS's
 * `node16` module resolution rejects a *static* `import` of an ESM module from
 * a CommonJS module (TS1479). Routing it through a `require()` call (which the
 * type-checker does not flag) keeps the exact runtime behavior while satisfying
 * TS 7. Import `nanoid` from here instead of directly from 'nanoid'.
 */
// Declare the tiny surface we use inline rather than `typeof import('nanoid')`
// so node16 doesn't demand a resolution-mode attribute for the ESM type import.
interface NanoidModule {
    nanoid: (size?: number,) => string;
    customAlphabet: (alphabet: string, defaultSize?: number,) => (size?: number,) => string;
}

const nanoidModule = require('nanoid') as NanoidModule;

export const nanoid = nanoidModule.nanoid;
export const customAlphabet = nanoidModule.customAlphabet;
