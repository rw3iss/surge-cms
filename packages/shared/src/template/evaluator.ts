/** Stage 3: evaluate the AST against an injected runtime → OutputNode[].
 *  Async because entity function calls (`post(id)`) fetch via the SDK.
 *
 *  Value → output rules:
 *   - an EntityRef with no trailing property → a whole-entity output node
 *   - null/undefined → '' (+ warning for an unresolved variable)
 *   - Date → localized date; array of scalars → comma-joined
 *   - everything else → String(value)
 *
 *  Interpolated values are emitted as-is (NOT HTML-escaped): block content is
 *  already trusted, admin-authored HTML (the HTML block injects raw content and
 *  the server sanitizes on save), and entity fields (title/content) come
 *  sanitized from the API — so escaping would wrongly show tags for rich fields.
 */
import type { Expr, Node, OutputNode, TemplateRuntime } from './types';
import { isEntityRef } from './types';

interface Scope {
    vars: Record<string, unknown>;
    parent: Scope | null;
}

function lookup(scope: Scope, name: string): { found: boolean; value: unknown } {
    let s: Scope | null = scope;
    while (s) {
        if (name in s.vars) return { found: true, value: s.vars[name] };
        s = s.parent;
    }
    return { found: false, value: undefined };
}

/** Navigate a property off a value (EntityRef reads from `.data`). */
function getProp(value: unknown, prop: string): unknown {
    if (value == null) return undefined;
    if (isEntityRef(value)) return value.data ? value.data[prop] : undefined;
    if (typeof value === 'object') return (value as Record<string, unknown>)[prop];
    return undefined;
}

async function evalExpr(expr: Expr, scope: Scope, rt: TemplateRuntime): Promise<unknown> {
    switch (expr.kind) {
        case 'lit':
            return expr.value;
        case 'unary':
            return !truthy(await evalExpr(expr.operand, scope, rt));
        case 'binary':
            return evalBinary(expr.op, expr.left, expr.right, scope, rt);
        case 'path': {
            const [head, ...rest] = expr.parts;
            let val: unknown;
            const hit = lookup(scope, head);
            if (hit.found) {
                val = hit.value;
            } else {
                // Zero-arg function fallback: `{{postCount}}` == `{{postCount()}}`,
                // `{{for posts as p}}` resolves the `posts` collection function.
                val = await rt.resolve(head, []);
            }
            for (const p of rest) val = getProp(val, p);
            return val;
        }
        case 'call': {
            // Evaluate args. A bare identifier arg that doesn't resolve to a
            // variable falls back to its literal name — so `post(some-id)` and
            // `post('some-id')` both work (forgiving for editors who omit quotes),
            // while `post(currentPost.id)` still resolves the variable.
            const args = await Promise.all(expr.args.map(async (a) => {
                const v = await evalExpr(a, scope, rt);
                if (v === undefined && a.kind === 'path') return a.parts.join('.');
                return v;
            }));
            let val = await rt.resolve(expr.name, args);
            for (const p of expr.props) val = getProp(val, p);
            return val;
        }
    }
}

async function evalBinary(op: string, l: Expr, r: Expr, scope: Scope, rt: TemplateRuntime): Promise<unknown> {
    if (op === '&&') return truthy(await evalExpr(l, scope, rt)) && truthy(await evalExpr(r, scope, rt));
    if (op === '||') {
        const lv = await evalExpr(l, scope, rt);
        return truthy(lv) ? lv : await evalExpr(r, scope, rt);
    }
    const a = await evalExpr(l, scope, rt);
    const b = await evalExpr(r, scope, rt);
    switch (op) {
        // eslint-disable-next-line eqeqeq
        case '==': return a == b;
        // eslint-disable-next-line eqeqeq
        case '!=': return a != b;
        case '>': return (a as number) > (b as number);
        case '<': return (a as number) < (b as number);
        case '>=': return (a as number) >= (b as number);
        case '<=': return (a as number) <= (b as number);
        default: return false;
    }
}

export function truthy(v: unknown): boolean {
    if (v == null || v === false || v === '' || v === 0) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isEntityRef(v)) return v.data != null;
    return true;
}

/** Convert a resolved scalar to its output string. Entities are handled by the
 *  caller (emitted as component nodes), so they never reach here. */
function stringify(v: unknown): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toLocaleDateString();
    if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x))).join(', ');
    if (typeof v === 'object') return '';
    return String(v);
}

class Emitter {
    private buf = '';
    readonly out: OutputNode[] = [];
    text(s: string): void { this.buf += s; }
    entity(kind: string, id: string | undefined, data: Record<string, unknown> | null): void {
        this.flush();
        this.out.push({ type: 'entity', kind, id, data });
    }
    flush(): void {
        if (this.buf) { this.out.push({ type: 'html', html: this.buf }); this.buf = ''; }
    }
}

async function evalNodes(nodes: Node[], scope: Scope, rt: TemplateRuntime, em: Emitter): Promise<void> {
    for (const node of nodes) {
        if (node.kind === 'text') { em.text(node.value); continue; }
        if (node.kind === 'interp') {
            let value: unknown;
            try {
                value = await evalExpr(node.expr, scope, rt);
            } catch (e) {
                rt.warn?.(`template: failed to evaluate {{${node.raw}}}: ${(e as Error).message}`);
                continue; // ignore unresolved syntax
            }
            if (isEntityRef(value)) {
                em.entity(value.kind, value.id, value.data);
            } else {
                if (value === undefined) rt.warn?.(`template: {{${node.raw}}} is undefined (ignored)`);
                em.text(stringify(value));
            }
            continue;
        }
        if (node.kind === 'if') {
            for (const branch of node.branches) {
                if (branch.cond === null || truthy(await evalExpr(branch.cond, scope, rt))) {
                    await evalNodes(branch.body, scope, rt, em);
                    break;
                }
            }
            continue;
        }
        if (node.kind === 'for') {
            const list = await evalExpr(node.list, scope, rt);
            const items = Array.isArray(list) ? list : (isEntityRef(list) && Array.isArray(list.data) ? list.data : []);
            if (!Array.isArray(list) && !Array.isArray((list as { data?: unknown })?.data)) {
                rt.warn?.(`template: {{for ${node.item}}} — value is not a list (ignored)`);
            }
            let i = 0;
            for (const it of items) {
                const child: Scope = { vars: { [node.item]: it }, parent: scope };
                if (node.index) child.vars[node.index] = i;
                await evalNodes(node.body, scope === child ? scope : child, rt, em);
                i++;
            }
            continue;
        }
    }
}

/** Evaluate a parsed template AST into ordered output nodes. */
export async function evaluate(ast: Node[], rt: TemplateRuntime): Promise<OutputNode[]> {
    const em = new Emitter();
    const root: Scope = { vars: rt.context, parent: null };
    await evalNodes(ast, root, rt, em);
    em.flush();
    return em.out;
}
