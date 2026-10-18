/**
 * Compact, documentation-only description of a route's zod input schemas.
 *
 * Feeds `manifest()` → docs/api-manifest.json → the in-admin API reference
 * (`/admin/help/api`). Read-only introspection: nothing here runs on a request
 * and nothing changes how a schema validates.
 *
 * Built on zod 4's `z.toJSONSchema` (input side, so coercions/transforms show
 * what a CALLER sends), then flattened to one row per top-level field — the
 * reference needs "which fields, which type, required or not", not a full
 * JSON Schema document.
 */
import { z, type ZodType, } from 'zod';
import type { RouteInput, } from './types';

export interface InputField {
    name: string;
    /** Compact TS-like type, e.g. `string`, `'a' | 'b'`, `number[]`, `object`. */
    type: string;
    required: boolean;
    description?: string;
}

export type InputDescription = Partial<Record<keyof RouteInput, InputField[]>>;

type Json = Record<string, unknown>;

const MAX_ENUM = 8;

/** One JSON Schema node → a short type string. */
function typeOf(node: Json | undefined, depth = 0,): string {
    if (!node || depth > 3) return 'unknown';
    if ('const' in node) return JSON.stringify(node.const,);
    if (Array.isArray(node.enum,)) {
        const vals = node.enum as unknown[];
        const shown = vals.slice(0, MAX_ENUM,).map((v,) => (typeof v === 'string' ? `'${v}'` : String(v,)));
        return shown.join(' | ',) + (vals.length > MAX_ENUM ? ' | …' : '');
    }
    const union = (node.anyOf ?? node.oneOf) as Json[] | undefined;
    if (Array.isArray(union,)) {
        const parts = [...new Set(union.map((u,) => typeOf(u, depth + 1,)),),];
        return parts.join(' | ',);
    }
    if (Array.isArray(node.allOf,)) return (node.allOf as Json[]).map((u,) => typeOf(u, depth + 1,)).join(' & ',);
    const t = node.type;
    if (Array.isArray(t,)) return t.join(' | ',);
    switch (t) {
        case 'string': return node.format ? `string<${String(node.format,)}>` : 'string';
        case 'integer': return 'integer';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'null': return 'null';
        case 'array': {
            const inner = typeOf(node.items as Json | undefined, depth + 1,);
            return inner.includes(' ',) ? `(${inner})[]` : `${inner}[]`;
        }
        case 'object': return 'object';
        default: return 'unknown';
    }
}

/** One channel's schema → its top-level fields. */
export function describeSchema(schema: ZodType,): InputField[] {
    let json: Json;
    try {
        json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', },) as Json;
    } catch {
        return [{ name: '(schema)', type: 'unknown', required: false, },];
    }
    const props = json.properties as Record<string, Json> | undefined;
    if (json.type === 'object' && props) {
        const required = new Set((json.required as string[] | undefined) ?? [],);
        return Object.entries(props,).map(([name, node,],) => {
            const field: InputField = { name, type: typeOf(node,), required: required.has(name,), };
            if (typeof node.description === 'string') field.description = node.description;
            return field;
        },);
    }
    // Not a plain object (a union, a record, an array body): describe the whole.
    return [{ name: '(body)', type: typeOf(json,), required: true, },];
}

/** All declared channels of a route, or undefined when it declares none. */
export function describeInput(input: RouteInput | undefined,): InputDescription | undefined {
    if (!input) return undefined;
    const out: InputDescription = {};
    for (const key of ['params', 'query', 'body',] as const) {
        const schema = input[key];
        if (schema) out[key] = describeSchema(schema,);
    }
    return Object.keys(out,).length ? out : undefined;
}
