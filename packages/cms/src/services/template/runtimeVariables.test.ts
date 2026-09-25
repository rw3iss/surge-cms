/**
 * The runtime merges editor-supplied variables LAST, so they win.
 *
 * `user` is the case that matters: in an email it is the RECIPIENT, not the
 * signed-in admin, so a mail preview must not show the operator's own name
 * where the sent copy will carry the subscriber's.
 */
import { describe, expect, it, } from 'vitest';
import { buildRuntime, } from './runtime';

/** Walk the runtime's ROOT context, which is what `{{a.b}}` resolves against. */
const resolveVar = (rt: ReturnType<typeof buildRuntime>, path: string,): unknown =>
    path.split('.',).reduce<unknown>(
        (acc, k,) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
        rt.context,
    );

describe('buildRuntime variables', () => {
    it('exposes an editor-supplied bag at the root', () => {
        const rt = buildRuntime({ variables: { list: { name: 'Weekly', }, }, },);
        expect(resolveVar(rt, 'list.name',),).toBe('Weekly',);
    },);

    it('lets the bag OVERRIDE user', () => {
        const rt = buildRuntime({
            user: { name: 'Admin Person', },
            variables: { user: { name: 'Sample Subscriber', }, },
        },);
        expect(resolveVar(rt, 'user.name',),).toBe('Sample Subscriber',);
    },);

    it('leaves user alone when the bag does not mention it', () => {
        const rt = buildRuntime({ user: { name: 'Admin Person', }, variables: { list: {}, }, },);
        expect(resolveVar(rt, 'user.name',),).toBe('Admin Person',);
    },);

    it('is a no-op when absent, so other editors are unaffected', () => {
        const rt = buildRuntime({ user: { name: 'Admin Person', }, },);
        expect(resolveVar(rt, 'user.name',),).toBe('Admin Person',);
        expect(resolveVar(rt, 'list.name',),).toBeUndefined();
    },);
},);
