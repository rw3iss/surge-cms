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

export interface SdkParam {
    /** Parameter name (a destructuring pattern is kept verbatim). */
    name: string;
    type: string;
    optional: boolean;
    /** Default value as written, if any. */
    default?: string;
    /** `@param` text from the JSDoc, if any. */
    doc?: string;
}

export interface SdkMethod {
    name: string;
    /** Rendered signature, e.g. `list(query?: PostListQuery): Promise<…>`. */
    signature: string;
    /** The method's JSDoc prose (tags removed), if any. */
    summary: string;
    params: SdkParam[];
    /** Declared return type, e.g. `Promise<PostListResponse>`; '' when inferred. */
    returns: string;
    /** API routes the method calls, in manifest form (`GET /api/v1/posts`),
     *  resolved against docs/api-manifest.json. */
    routes: string[];
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

/** The raw JSDoc block immediately above `index`, if there is one. */
function rawDocAbove(lines: string[], index: number,): string {
    let i = index - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    if (i < 0 || !lines[i].trim().endsWith('*/',)) return '';
    const endLine = i;
    while (i >= 0 && !lines[i].trim().startsWith('/**',)) i--;
    if (i < 0) return '';
    return lines.slice(i, endLine + 1,).join('\n',);
}

/** The JSDoc block immediately above `index`, as one line of prose. */
function docAbove(lines: string[], index: number,): string {
    const raw = rawDocAbove(lines, index,);
    return raw ? cleanDoc(raw,) : '';
}

/** `@param name text` tags of a raw JSDoc block. */
function paramDocs(raw: string,): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of raw.matchAll(/@param\s+(?:\{[^}]*\}\s+)?\[?([A-Za-z_$][\w$]*)\]?\s*-?\s*([^@]*)/g,)) {
        const text = m[2].split('\n',).map((l,) => l.replace(/^\s*\*\/?\s?/, '',).trim()).join(' ',)
            .replace(/\*\/$/, '',).replace(/\s+/g, ' ',).trim();
        if (text) out.set(m[1], text,);
    }
    return out;
}

/** Split on commas at nesting depth 0 (generics, object types, tuples, calls). */
function splitTopLevel(text: string,): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
        else if ((ch === '>' && text[i - 1] !== '=') || ch === '}' || ch === ']' || ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur,); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur,);
    return parts.map((p,) => p.trim()).filter(Boolean,);
}

/** Index of the first `:` or `=` at depth 0 (a param's name/type boundary). */
function topLevelIndex(text: string, chars: string,): number {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
        else if ((ch === '>' && text[i - 1] !== '=') || ch === '}' || ch === ']' || ch === ')') depth--;
        else if (depth === 0 && chars.includes(ch,) && !(ch === '=' && text[i + 1] === '>')) return i;
    }
    return -1;
}

/** Type of an un-annotated param, read off its default (`= false` → boolean). */
function inferType(def: string | undefined,): string {
    if (def === undefined) return 'unknown';
    if (def === 'true' || def === 'false') return 'boolean';
    if (/^-?\d+(\.\d+)?$/.test(def,)) return 'number';
    if (/^['"`]/.test(def,)) return 'string';
    if (def.startsWith('[',)) return 'unknown[]';
    if (def.startsWith('{',)) return 'object';
    return 'unknown';
}

/** `(a: T, b?: U = x)` parameter text → structured params. */
function parseParams(text: string, docs: Map<string, string>,): SdkParam[] {
    return splitTopLevel(text,).map((raw,) => {
        let rest = raw;
        let def: string | undefined;
        const eq = (() => {
            // `=` that is not part of `=>` and sits at depth 0.
            let depth = 0;
            for (let i = 0; i < rest.length; i++) {
                const ch = rest[i];
                if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
                else if ((ch === '>' && rest[i - 1] !== '=') || ch === '}' || ch === ']' || ch === ')') depth--;
                else if (depth === 0 && ch === '=' && rest[i + 1] !== '>') return i;
            }
            return -1;
        })();
        if (eq !== -1) { def = rest.slice(eq + 1,).trim(); rest = rest.slice(0, eq,).trim(); }
        const colon = topLevelIndex(rest, ':',);
        let name = (colon === -1 ? rest : rest.slice(0, colon,)).trim();
        const type = colon === -1 ? inferType(def,) : rest.slice(colon + 1,).trim();
        let optional = def !== undefined;
        if (name.endsWith('?',)) { optional = true; name = name.slice(0, -1,).trim(); }
        if (name.startsWith('...',)) optional = true;
        const p: SdkParam = { name, type, optional, };
        if (def !== undefined) p.default = def;
        const doc = docs.get(name.replace(/^\.\.\./, '',),);
        if (doc) p.doc = doc;
        return p;
    },);
}

/** Collapse a multi-line type to one line, as the signature does. */
function oneLine(text: string,): string {
    return text.replace(/\s+/g, ' ',).replace(/,\s*([)}\]>])/g, ' $1',).replace(/\s+([)}\]>])/g, '$1',)
        .replace(/([({\[<])\s+/g, '$1',).replace(/\{(\S)/g, '{ $1',).replace(/(\S)\}/g, '$1 }',).trim();
}

// ── Route resolution ──────────────────────────────────────────────────────
// Each method's body names the path it calls (`this.get('/posts/:id', …)`,
// `this.mutate('POST', \`/posts/${id}\`, …)`). Resolving that against the
// route manifest gives a CANONICAL route string, so the SDK reference can link
// to the API reference and the API reference can name the SDK method.

const MANIFEST_FILE = resolve(import.meta.dirname, '../../../docs/api-manifest.json',);

interface ManifestRouteRef { method: string; absolutePath: string; }

let manifestRoutes: ManifestRouteRef[] | null = null;
function loadManifestRoutes(): ManifestRouteRef[] {
    if (manifestRoutes) return manifestRoutes;
    const doc = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8',),) as {
        modules: Array<{ routes: ManifestRouteRef[]; }>;
    };
    manifestRoutes = doc.modules.flatMap((m,) => m.routes.map((r,) => ({ method: r.method, absolutePath: r.absolutePath, })),);
    return manifestRoutes;
}

/** Best manifest route for (method, path): literal segments must agree, `:x`
 *  matches anything, and the route with the most literal matches wins (so
 *  `/posts/types` beats `/posts/:id`). */
export function resolveRoute(method: string, path: string,): string | null {
    const segs = path.split('/',);
    let best: { route: string; score: number; } | null = null;
    for (const r of loadManifestRoutes()) {
        if (r.method !== method) continue;
        const rs = r.absolutePath.split('/',);
        if (rs.length !== segs.length) continue;
        let score = 0;
        let ok = true;
        for (let i = 0; i < rs.length; i++) {
            const a = rs[i];
            const b = segs[i];
            const ap = a.startsWith(':',);
            const bp = b.startsWith(':',);
            // Same kind scores: literal = literal, or param = param (so a call
            // to `/posts/:id` lands on the `:id` route, not `/posts/types`).
            if ((a === b && !ap) || (ap && bp)) score++;
            else if (ap || bp) continue;
            else { ok = false; break; }
        }
        if (ok && (!best || score > best.score)) best = { route: `${r.method} ${r.absolutePath}`, score, };
    }
    return best?.route ?? null;
}

const HELPER_METHOD: Record<string, string> = { get: 'GET', getPaged: 'GET', rawGet: 'GET', url: 'GET', uploadForm: 'POST', };

/** Normalise a path literal from the source: template holes → `:p`, no query. */
function normalisePath(p: string, rootMounted: boolean,): string {
    const path = p.replace(/\$\{[^}]*\}/g, ':p',).split('?',)[0].replace(/\/$/, '',) || '/';
    return rootMounted || path.startsWith('/api/',) ? path : `/api/v1${path === '/' ? '' : path}`;
}

/** Routes a method calls: from the HTTP helper calls in its body, else from a
 *  `GET /x — …` style summary. */
function routesOf(body: string, summary: string,): string[] {
    const found: string[] = [];
    const rootMounted = /rootMounted:\s*true/.test(body,);
    const helper = /(?:this|super)\.(get|getPaged|rawGet|url|uploadForm|mutate)\b/g;
    for (const m of body.matchAll(helper,)) {
        let i = (m.index ?? 0) + m[0].length;
        // Skip an explicit generic argument, balancing <> (but not `=>`).
        if (body[i] === '<') {
            let depth = 0;
            for (; i < body.length; i++) {
                if (body[i] === '<') depth++;
                else if (body[i] === '>' && body[i - 1] !== '=') { depth--; if (depth === 0) { i++; break; } }
            }
        }
        if (body[i] !== '(') continue;
        const args = body.slice(i + 1,);
        let method = HELPER_METHOD[m[1]];
        let rest = args;
        if (m[1] === 'mutate') {
            const mm = /^\s*'(POST|PUT|PATCH|DELETE)'\s*,\s*/.exec(args,);
            if (!mm) continue;
            method = mm[1];
            rest = args.slice(mm[0].length,);
        }
        const lit = /^\s*(['`])((?:(?!\1).)*)\1/.exec(rest,);
        if (!lit || !lit[2].startsWith('/',)) continue;
        // A path the client prefixes with /api/v1 may be a root-mounted route
        // (`/admin/sitemap/regenerate`); try the literal path second.
        const route = resolveRoute(method, normalisePath(lit[2], rootMounted,),)
            ?? resolveRoute(method, normalisePath(lit[2], true,),);
        if (route && !found.includes(route,)) found.push(route,);
    }
    // URL builders: `${this.core.config.apiBase}/settings/backup?…` or a
    // literal `/api/v1/…` string — a GET the caller navigates to.
    for (const m of body.matchAll(/`(?:\$\{[^}]*(?:apiBase|baseUrl)[^}]*\})?(\/[^`\s]*)`/g,)) {
        const raw = m[1];
        const isAbsolute = raw.startsWith('/api/',);
        if (!isAbsolute && !/apiBase|baseUrl/.test(m[0],)) continue;
        const route = resolveRoute('GET', normalisePath(raw, isAbsolute,),);
        if (route && !found.includes(route,)) found.push(route,);
    }
    if (found.length) return found;
    for (const m of summary.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,;—)]*)/g,)) {
        const route = resolveRoute(m[1], normalisePath(m[2], m[2].startsWith('/feed',) || m[2].startsWith('/sitemap',),),);
        if (route && !found.includes(route,)) found.push(route,);
    }
    return found;
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
 * Accumulate one member's source, from its first line to the token that opens
 * its BODY — `{` for a class method, `=>` for an arrow property.
 *
 * Two phases, and the second is the point of the function: balancing the
 * PARAMETER parens is not enough to have read the whole signature. A return
 * type written as an inline object type spans several lines:
 *
 *     pending: (): Promise<{
 *         products: Array<{ … }>;
 *     }> => this.get('/shop/merchandise/pending',),
 *
 * Stopping at the closing paren truncated that to `pending(): Promise<{`.
 *
 * Both phases are depth-aware, so a `{` inside a generic argument and the `=>`
 * inside `Promise<() => void>` don't end the scan early.
 */
function collectSignature(
    lines: string[],
    start: number,
    limit: number,
    body: 'brace' | 'arrow',
): { sig: string; cut: number; end: number; paramsStart: number; paramsEnd: number; } {
    let sig = '';
    let paramsStart = -1;
    let parens = 0;
    let opened = false;
    let paramsEnd = -1;
    let angle = 0;
    let brace = 0;
    let cut = -1;
    let j = start;

    for (; j < limit; j++) {
        const text = (sig ? ' ' : '') + lines[j].trim();
        const base = sig.length;
        for (let c = 0; c < text.length && cut === -1; c++) {
            const ch = text[c];
            if (paramsEnd === -1) {
                // Phase 1 — parameters. Only parens count: a param may be an
                // inline object type, whose braces are not the body.
                if (ch === '(') {
                    if (!opened) paramsStart = base + c;
                    parens++;
                    opened = true;
                }
                else if (ch === ')') {
                    parens--;
                    if (opened && parens === 0) paramsEnd = base + c;
                }
                continue;
            }
            // Phase 2 — return type, up to the body token.
            if (ch === '<') angle++;
            // `=>` is an arrow, not a closing generic. Counting it drove the
            // depth negative, so the body token was never found.
            else if (ch === '>' && text[c - 1] !== '=') angle--;
            else if (ch === '{') {
                if (body === 'brace' && angle === 0 && brace === 0) { cut = base + c; break; }
                brace++;
            } else if (ch === '}') brace--;
            else if (body === 'arrow' && ch === '=' && text[c + 1] === '>' && angle === 0 && brace === 0) {
                cut = base + c;
            }
        }
        sig += text;
        if (cut !== -1) break;
    }
    return { sig, cut: cut === -1 ? sig.length : cut, end: j, paramsStart, paramsEnd, };
}

/** Params + return type out of a collected signature. */
function details(sig: string, cut: number, paramsStart: number, paramsEnd: number, raw: string,): Pick<SdkMethod, 'params' | 'returns'> {
    if (paramsStart === -1 || paramsEnd === -1) return { params: [], returns: '', };
    const params = parseParams(sig.slice(paramsStart + 1, paramsEnd,), paramDocs(raw,),);
    const tail = sig.slice(paramsEnd + 1, cut,).trim();
    const returns = tail.startsWith(':',) ? oneLine(tail.slice(1,),) : '';
    return { params: params.map((p,) => ({ ...p, type: oneLine(p.type,), })), returns, };
}

/**
 * Methods of one class body.
 *
 * Signatures are collected by scanning rather than by regex — a handful wrap
 * across lines. The body is then skipped by balancing braces so a nested
 * function inside a method can't be mistaken for the next method.
 */
function parseMethods(lines: string[], from: number, to: number,): SdkMethod[] {
    const methods: SdkMethod[] = [];
    let i = from;
    while (i < to) {
        const line = lines[i];
        // A member sits at exactly one indent level inside the class body.
        const m = /^    (?!(?:protected|private|readonly|static)\b)(?:async\s+)?([A-Za-z][\w]*)\s*(?:<.*>\s*)?\(/.exec(line,);
        if (!m || SKIP.has(m[1],)) { i++; continue; }

        // Cut at the body brace, not at the last `)`: a one-line body
        // (`f(): T { return this.x(); }`) ends in a paren that belongs to the
        // body, and cutting there swallowed it into the signature.
        const { sig, cut, end: j, paramsStart, paramsEnd, } = collectSignature(lines, i, to, 'brace',);
        const clean = sig.slice(0, cut,)
            .replace(/\s+/g, ' ',)
            .replace(/,\s*\)/g, ')',)   // house style writes a trailing comma in params
            .replace(/\(\s+/g, '(',)    // a wrapped param list joins with a space
            .replace(/^async\s+/, '',)
            .trim();

        const summary = docAbove(lines, i,);
        const raw = rawDocAbove(lines, i,);
        const start = i;

        // Skip the body: balance braces from the signature line onward, so a
        // nested function inside a method isn't read as the next method.
        // Counting starts AT the body brace: a multi-line object-type param
        // closes (`},): T {`) on the same line, and counting the whole line
        // read the body as already finished.
        let bodyBraces = 0;
        let bodyOpened = false;
        for (let k = j; k < to; k++) {
            const text = k === j ? sig.slice(cut,) : lines[k];
            for (const ch of text) {
                if (ch === '{') { bodyBraces++; bodyOpened = true; }
                else if (ch === '}') bodyBraces--;
            }
            if (bodyOpened && bodyBraces === 0) { i = k + 1; break; }
            if (k === to - 1) i = to;
        }
        if (i <= j) i = j + 1;

        const body = sig.slice(cut,) + '\n' + lines.slice(j + 1, i,).join('\n',);
        methods.push({
            name: m[1],
            signature: clean,
            summary,
            ...details(sig, cut, paramsStart, paramsEnd, raw,),
            routes: routesOf(body, summary,),
        },);
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

            // Everything up to the `=>` that starts the body is the signature.
            const { sig, cut, end: sigEnd, paramsStart, paramsEnd, } = collectSignature(lines, k, end, 'arrow',);
            // The arrow body runs to the next property at this indent (or the
            // end of the group).
            let next = sigEnd + 1;
            while (next < end && !/^        [A-Za-z][\w]*\s*:/.test(lines[next],)) next++;
            const body = sig.slice(cut,) + '\n' + lines.slice(sigEnd + 1, next,).join('\n',);
            const summary = docAbove(lines, k,);
            const clean = sig.slice(0, cut,)
                .replace(/\s+/g, ' ',)
                .replace(/,\s*\)/g, ')',)
                .replace(/\(\s+/g, '(',)   // a wrapped param list joins with a space
                .replace(/:\s*\(/, '(',)   // `name: (a) : T` reads better as `name(a): T`
                .trim();
            out.push({
                name: `${g[1]}.${m[1]}`,
                // Prefix the group so the signature is what you'd actually
                // type: `products.list(...)`, not a bare `list(...)` that
                // doesn't exist on the namespace.
                signature: `${g[1]}.${clean}`,
                summary,
                ...details(sig, cut, paramsStart, paramsEnd, rawDocAbove(lines, k,),),
                routes: routesOf(body, summary,),
            },);
        }
        i = end;
    }
    return out;
}

/**
 * A convenience method that only calls a sibling (`hot()` → `this.query(…)`,
 * `count()` → `this.list(…)`) hits the sibling's routes. One pass is enough:
 * the SDK has no chains of such wrappers.
 */
function inheritDelegatedRoutes(methods: SdkMethod[], classLines: string[],): void {
    const byName = new Map(methods.map((m,) => [m.name, m,]),);
    const text = classLines.join('\n',);
    for (const m of methods) {
        if (m.routes.length || m.name.includes('.',)) continue;
        // The method's own source: from its declaration to the next member.
        const start = text.search(new RegExp(`^    (?:async\\s+)?${m.name}\\s*(?:<[^\\n]*>\\s*)?\\(`, 'm',),);
        if (start === -1) continue;
        const rest = text.slice(start + 1,);
        const next = rest.search(/^    (?:\/\*\*|(?:async\s+)?[A-Za-z][\w]*\s*(?:<[^\n]*>\s*)?\()/m,);
        const own = next === -1 ? rest : rest.slice(0, next,);
        for (const call of own.matchAll(/this\.([A-Za-z][\w]*)\s*\(/g,)) {
            const target = byName.get(call[1],);
            if (target && target !== m) for (const r of target.routes) if (!m.routes.includes(r,)) m.routes.push(r,);
        }
    }
}

/** Every exported module class, with its methods. */
function readClasses(): Map<string, SdkModuleDoc> {
    const out = new Map<string, SdkModuleDoc>();
    for (const file of readdirSync(MODULES_DIR,)) {
        if (!file.endsWith('.ts',) || file.endsWith('.test.ts',)) continue;
        const lines = readFileSync(join(MODULES_DIR, file,), 'utf8',).split('\n',);

        for (let i = 0; i < lines.length; i++) {
            // Network modules extend ModuleBase; a local one (cms.ui) is a plain class.
            const m = /^export class ([A-Za-z][\w]*)(?:\s+extends\s+ModuleBase\b)?[^{]*\{/.exec(lines[i],);
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

            const methods = [...parseMethods(lines, i + 1, end,), ...parseGroups(lines, i + 1, end,),]
                .sort((a, b,) => a.name.localeCompare(b.name,));
            inheritDelegatedRoutes(methods, lines.slice(i + 1, end,),);
            out.set(m[1], {
                namespace: '',
                className: m[1],
                summary: docAbove(lines, i,),
                methods,
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
// The SDK reference shown at /admin/help/sdk/reference, built from the
// @sitesurge/client source (routes resolved against docs/api-manifest.json)
// so it cannot drift from the real surface.
// Regenerate with: npm run docs:sdk -w @sitesurge/admin  (or root npm run docs:api)

export interface SdkParamDoc {
    name: string;
    type: string;
    optional: boolean;
    default?: string;
    doc?: string;
}

export interface SdkMethodDoc {
    name: string;
    signature: string;
    summary: string;
    params: SdkParamDoc[];
    returns: string;
    /** API routes called, e.g. \`GET /api/v1/posts\` (anchors in the API reference). */
    routes: string[];
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
