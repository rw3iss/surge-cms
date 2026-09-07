/**
 * Generate the in-admin SDK module reference from the client's own source.
 *
 * WHY GENERATED: the reference lists every namespace on `cms` and every method
 * on each one. Hand-written, it is wrong the first time somebody adds a method
 * — and a reference that is quietly wrong is worse than none, because a reader
 * has no way to tell. Parsing `@sitesurge/client` means the page can only ever
 * describe what the SDK actually exposes.
 *
 * Run:  npm run docs:sdk -w @sitesurge/admin
 * Guard: services/help/sdkModules.test.ts fails if the committed output is
 *        stale, so a new SDK method can't ship with the docs left behind.
 *
 * Deliberately a build-time generator rather than runtime reflection: method
 * SIGNATURES and JSDoc exist only in the TypeScript source, not at runtime.
 */
import { readdirSync, readFileSync, writeFileSync, } from 'node:fs';
import { join, resolve, } from 'node:path';
// Parsed by hand rather than with the TypeScript compiler API: this repo is on
// TypeScript 7, the native port, whose npm package no longer exposes the JS
// compiler API (`require('typescript')` yields only `version`). Adding a second
// TypeScript purely to read four things out of very regular, formatter-enforced
// source is a poor trade — and the drift test below catches a parser that
// silently stops seeing methods.

const MODULES_DIR = resolve(import.meta.dirname, '../../cms-client/src/modules',);
const OUT_FILE = resolve(import.meta.dirname, '../src/services/help/sdkModules.generated.ts',);

export interface SdkMethod {
    name: string;
    /** Rendered signature, e.g. `list(query?: PostListQuery): Promise<…>`. */
    signature: string;
    /** First line of the method's JSDoc, if any. */
    summary: string;
}

export interface SdkModuleDoc {
    /** Property on `cms`, e.g. `posts`. */
    namespace: string;
    /** Implementing class, e.g. `PostsModule`. */
    className: string;
    /** First line of the class's JSDoc. */
    summary: string;
    methods: SdkMethod[];
}

/** Strip JSDoc decoration down to one line of prose. */
function cleanDoc(block: string,): string {
    return block
        .split('\n',)
        .map((l,) => l.trim().replace(/^\/\*\*/, '',).replace(/\*\/$/, '',))
        .join('\n',)
        .split('\n',)
        .map((l,) => l.replace(/^\s*\*\s?/, '',).trim())
        .filter((l,) => l && !l.startsWith('@',))
        .join(' ',)
        .replace(/\s+/g, ' ',)
        .trim();
}

/** The JSDoc block immediately above `index`, if there is one. */
function docAbove(lines: string[], index: number,): string {
    let i = index - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    if (i < 0 || !lines[i].trim().endsWith('*/',)) return '';
    const endLine = i;
    while (i >= 0 && !lines[i].trim().startsWith('/**',)) i--;
    if (i < 0) return '';
    return cleanDoc(lines.slice(i, endLine + 1,).join('\n',),);
}

/** namespace → class name, read from the assignments in modules/index.ts. */
function readNamespaceMap(): Map<string, string> {
    const text = readFileSync(join(MODULES_DIR, 'index.ts',), 'utf8',);
    const map = new Map<string, string>();
    for (const m of text.matchAll(/^\s*c\.([A-Za-z][\w]*)\s*=\s*new\s+([A-Za-z][\w]*)\(/gm,)) {
        map.set(m[1], m[2],);
    }
    return map;
}

/** Members we never want in a reference: the base-class HTTP helpers and any
 *  declared field. `protected`/`private` are filtered before this. */
const SKIP = new Set(['constructor', 'module',],);

/**
 * Methods of one class body.
 *
 * Signatures are collected by balancing parentheses rather than assuming one
 * line — a handful genuinely wrap. The body is then skipped by balancing braces
 * so a nested function inside a method can't be mistaken for the next method.
 */
function parseMethods(lines: string[], from: number, to: number,): SdkMethod[] {
    const methods: SdkMethod[] = [];
    let i = from;
    while (i < to) {
        const line = lines[i];
        // A member sits at exactly one indent level inside the class body.
        const m = /^    (?!(?:protected|private|readonly|static)\b)(?:async\s+)?([A-Za-z][\w]*)\s*\(/.exec(line,);
        if (!m || SKIP.has(m[1],)) { i++; continue; }

        // Accumulate lines until the PARAMETER parens balance. A parameter type
        // may itself contain parens or braces, so this has to be a scan rather
        // than a regex.
        let sig = '';
        let parens = 0;
        let opened = false;
        let paramsEnd = -1;
        let j = i;
        outer: for (; j < to; j++) {
            const text = (sig ? ' ' : '') + lines[j].trim();
            for (let k = 0; k < text.length; k++) {
                const ch = text[k];
                if (ch === '(') { parens++; opened = true; }
                else if (ch === ')') {
                    parens--;
                    if (opened && parens === 0) {
                        paramsEnd = sig.length + k;
                        sig += text;
                        break outer;
                    }
                }
            }
            sig += text;
        }

        // The body brace is the first `{` after the parameters at bracket depth
        // zero. Searching back from the last `)` instead put a one-line body
        // (`f(): T { return this.x(); }`) into the signature, because that `)`
        // belongs to the body.
        let cut = sig.length;
        let angle = 0;
        let brace = 0;
        for (let k = paramsEnd + 1; k < sig.length; k++) {
            const ch = sig[k];
            if (ch === '<') angle++;
            // `=>` in a return type is an arrow, not a closing generic. Counting
            // it drove the depth negative, so the body brace of
            // `onChange(cb): () => void { … }` was never found.
            else if (ch === '>' && sig[k - 1] !== '=') angle--;
            else if (ch === '{') {
                if (angle === 0 && brace === 0) { cut = k; break; }
                brace++;
            } else if (ch === '}') brace--;
        }
        const clean = sig.slice(0, cut,)
            .replace(/\s+/g, ' ',)
            .replace(/,\s*\)/g, ')',)   // house style writes a trailing comma in params
            .replace(/^async\s+/, '',)
            .trim();

        methods.push({ name: m[1], signature: clean, summary: docAbove(lines, i,), },);

        // Skip the body: balance braces from the signature line onward, so a
        // nested function inside a method isn't read as the next method.
        let bodyBraces = 0;
        let bodyOpened = false;
        for (let k = j; k < to; k++) {
            for (const ch of lines[k]) {
                if (ch === '{') { bodyBraces++; bodyOpened = true; }
                else if (ch === '}') bodyBraces--;
            }
            if (bodyOpened && bodyBraces === 0) { i = k + 1; break; }
            if (k === to - 1) i = to;
        }
        if (i <= j) i = j + 1;
    }
    return methods;
}

/**
 * Sub-namespace groups: `readonly products = { list: (…) => …, … }`.
 *
 * A big part of the surface lives here (cms.shop.products.list, and similar on
 * settings/entities), so a reference that only walked class methods reported
 * `cms.shop` as having ONE method. Emitted with dotted names, which is exactly
 * how a caller writes them.
 */
function parseGroups(lines: string[], from: number, to: number,): SdkMethod[] {
    const out: SdkMethod[] = [];
    for (let i = from; i < to; i++) {
        const g = /^    (?:readonly\s+)?([A-Za-z][\w]*)\s*=\s*\{\s*$/.exec(lines[i],);
        if (!g) continue;

        // Extent of the object literal.
        let brace = 0;
        let end = to;
        for (let k = i; k < to; k++) {
            for (const ch of lines[k]) {
                if (ch === '{') brace++;
                else if (ch === '}') brace--;
            }
            if (brace === 0 && k > i) { end = k; break; }
        }

        for (let k = i + 1; k < end; k++) {
            // Arrow-function property at one further indent level.
            const m = /^        ([A-Za-z][\w]*)\s*:\s*\(/.exec(lines[k],);
            if (!m) continue;

            let sig = '';
            let parens = 0;
            let opened = false;
            let paramsEnd = -1;
            let j = k;
            outer: for (; j < end; j++) {
                const text = (sig ? ' ' : '') + lines[j].trim();
                for (let c = 0; c < text.length; c++) {
                    const ch = text[c];
                    if (ch === '(') { parens++; opened = true; }
                    else if (ch === ')') {
                        parens--;
                        if (opened && parens === 0) { paramsEnd = sig.length + c; sig += text; break outer; }
                    }
                }
                sig += text;
            }
            // Everything up to the `=>` that starts the body is the signature.
            const arrow = sig.indexOf('=>', paramsEnd,);
            const clean = (arrow === -1 ? sig : sig.slice(0, arrow,))
                .replace(/\s+/g, ' ',)
                .replace(/,\s*\)/g, ')',)
                .replace(/:\s*\(/, '(',)   // `name: (a) : T` reads better as `name(a): T`
                .trim();
            out.push({
                name: `${g[1]}.${m[1]}`,
                // Prefix the group so the signature is what you'd actually
                // type: `products.list(...)`, not a bare `list(...)` that
                // doesn't exist on the namespace.
                signature: `${g[1]}.${clean}`,
                summary: docAbove(lines, k,),
            },);
        }
        i = end;
    }
    return out;
}

/** Every exported module class, with its methods. */
function readClasses(): Map<string, SdkModuleDoc> {
    const out = new Map<string, SdkModuleDoc>();
    for (const file of readdirSync(MODULES_DIR,)) {
        if (!file.endsWith('.ts',) || file.endsWith('.test.ts',)) continue;
        const lines = readFileSync(join(MODULES_DIR, file,), 'utf8',).split('\n',);

        for (let i = 0; i < lines.length; i++) {
            const m = /^export class ([A-Za-z][\w]*)\s+extends\s+ModuleBase\b[^{]*\{/.exec(lines[i],);
            if (!m) continue;

            // Find the end of the class body.
            let braces = 0;
            let end = lines.length;
            for (let k = i; k < lines.length; k++) {
                for (const ch of lines[k]) {
                    if (ch === '{') braces++;
                    else if (ch === '}') braces--;
                }
                if (braces === 0 && k > i) { end = k; break; }
            }

            out.set(m[1], {
                namespace: '',
                className: m[1],
                summary: docAbove(lines, i,),
                methods: [...parseMethods(lines, i + 1, end,), ...parseGroups(lines, i + 1, end,),]
                    .sort((a, b,) => a.name.localeCompare(b.name,)),
            },);
            i = end;
        }
    }
    return out;
}

export function buildSdkModuleDocs(): SdkModuleDoc[] {
    const namespaces = readNamespaceMap();
    const classes = readClasses();
    const docs: SdkModuleDoc[] = [];

    for (const [namespace, className,] of namespaces) {
        const found = classes.get(className,);
        // A namespace whose class we can't find is a generator bug, not a
        // reason to emit a half-list — say so loudly.
        if (!found) throw new Error(`No class "${className}" found for cms.${namespace}`,);
        docs.push({ ...found, namespace, },);
    }
    return docs.sort((a, b,) => a.namespace.localeCompare(b.namespace,));
}

export function renderFile(docs: SdkModuleDoc[],): string {
    return `// GENERATED by packages/cms/scripts/generate-sdk-modules.ts — DO NOT EDIT.
//
// The SDK module reference shown at /admin/help/sdk/component-js, built from
// the @sitesurge/client source so it cannot drift from the real surface.
// Regenerate with: npm run docs:sdk -w @sitesurge/admin

export interface SdkMethodDoc {
    name: string;
    signature: string;
    summary: string;
}

export interface SdkModuleDoc {
    namespace: string;
    className: string;
    summary: string;
    methods: SdkMethodDoc[];
}

export const SDK_MODULES: SdkModuleDoc[] = ${JSON.stringify(docs, null, 4,)};

export const SDK_MODULE_COUNT = ${docs.length};
export const SDK_METHOD_COUNT = ${docs.reduce((n, d,) => n + d.methods.length, 0,)};
`;
}

// Executed directly (not imported by the drift test).
if (process.argv[1]?.endsWith('generate-sdk-modules.ts',)) {
    const docs = buildSdkModuleDocs();
    writeFileSync(OUT_FILE, renderFile(docs,),);
    const methods = docs.reduce((n, d,) => n + d.methods.length, 0,);
    console.log(`Wrote ${OUT_FILE}\n  ${docs.length} modules, ${methods} methods.`,);
}
