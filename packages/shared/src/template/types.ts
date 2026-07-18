/**
 * AST + runtime types for the content-block `{{ … }}` template engine.
 *
 * The engine has three pure, framework-free stages:
 *   1. tokenize(src)  → Token[]        (text vs `{{…}}` tags)
 *   2. parse(tokens)  → Node[]         (interpolations + if/for control flow)
 *   3. evaluate(ast)  → OutputNode[]   (async; resolves values + entities)
 *
 * Stages 1–2 are synchronous + dependency-free (unit-testable in isolation).
 * Stage 3 takes an injected `TemplateRuntime` (context vars + function
 * resolvers), so the SDK/entity wiring lives outside the engine.
 */

// ── Expressions ────────────────────────────────────────────────────────────────
export type Expr = LiteralExpr | PathExpr | CallExpr | UnaryExpr | BinaryExpr;

export interface LiteralExpr { kind: 'lit'; value: string | number | boolean | null; }
/** Dotted variable path, e.g. `post.title` → parts `['post','title']`. */
export interface PathExpr { kind: 'path'; parts: string[]; }
/** Function call with optional trailing property access, e.g. `post(id).title`
 *  → name `post`, args `[id]`, props `['title']`. Empty `props` → whole entity. */
export interface CallExpr { kind: 'call'; name: string; args: Expr[]; props: string[]; }
export interface UnaryExpr { kind: 'unary'; op: '!'; operand: Expr; }
export interface BinaryExpr { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; }
export type BinaryOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||';

// ── Template AST ────────────────────────────────────────────────────────────────
export type Node = TextNode | InterpNode | IfNode | ForNode;

export interface TextNode { kind: 'text'; value: string; }
/** `{{ expr }}` — `raw` kept for warning messages. */
export interface InterpNode { kind: 'interp'; expr: Expr; raw: string; }
export interface IfNode { kind: 'if'; branches: IfBranch[]; }
/** `cond === null` marks the trailing `{{else}}` branch. */
export interface IfBranch { cond: Expr | null; body: Node[]; }
/** `{{ for <list> as <item> }} … {{ endfor }}` (optional `, <index>`). */
export interface ForNode { kind: 'for'; list: Expr; item: string; index: string | null; body: Node[]; }

// ── Runtime values ──────────────────────────────────────────────────────────────
/** Tag marking a value as a renderable CMS entity. When an interpolation
 *  resolves to one of these WITH no trailing property, the whole entity is
 *  rendered (via its component); with a property, the property is read off
 *  `data`. Context entities (e.g. the current post) and function results
 *  (`post(id)`) both use this shape, so `{{post}}` and `{{post(id)}}` behave
 *  identically. */
export interface EntityRef {
    __entity: true;
    kind: string;
    id?: string;
    data: Record<string, unknown> | null;
}

export function isEntityRef(v: unknown): v is EntityRef {
    return typeof v === 'object' && v !== null && (v as EntityRef).__entity === true;
}

export function entityRef(kind: string, data: Record<string, unknown> | null, id?: string): EntityRef {
    return { __entity: true, kind, data, id };
}

// ── Output ──────────────────────────────────────────────────────────────────────
/** Ordered render output: coalesced HTML strings interleaved with whole-entity
 *  segments (rendered as components by `<TemplatedContent>`). */
export type OutputNode =
    | { type: 'html'; html: string }
    | { type: 'entity'; kind: string; id?: string; data: Record<string, unknown> | null };

// ── Runtime (injected into evaluate) ────────────────────────────────────────────
export interface TemplateRuntime {
    /** Root variables (`user`, `site`, `post`, `campaign`, …). */
    context: Record<string, unknown>;
    /** Resolve a function call, e.g. `post('id')`. Returns a value (often an
     *  EntityRef) or `undefined` when unknown/not found. May be async. */
    resolve(name: string, args: unknown[]): Promise<unknown> | unknown;
    /** Optional warning sink (defaults to console.warn) for unresolved refs /
     *  parse errors — helps editors debug their syntax. */
    warn?: (message: string) => void;
}

export class TemplateParseError extends Error {}
