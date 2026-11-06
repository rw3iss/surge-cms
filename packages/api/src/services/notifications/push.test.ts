import { describe, expect, it, } from 'vitest';
import { pushEndpointProblem, } from './push';

describe('pushEndpointProblem', () => {
    it('accepts the browser push services', () => {
        expect(pushEndpointProblem('https://fcm.googleapis.com/fcm/send/abc:def',),).toBeNull();
        expect(pushEndpointProblem('https://updates.push.services.mozilla.com/wpush/v2/gAAA',),).toBeNull();
        expect(pushEndpointProblem('https://web.push.apple.com/QGx',),).toBeNull();
    },);

    it('refuses anything that could reach an internal service', () => {
        for (const bad of [
            'http://fcm.googleapis.com/x',
            'https://127.0.0.1/x',
            'https://10.0.0.5/x',
            'https://[::1]/x',
            'https://localhost/x',
            'https://redis.internal/x',
            'https://printer.local/x',
            'https://intranet/x',
            'https://push.example.com:6379/x',
            'https://user:pw@push.example.com/x',
            'not a url',
        ]) expect(pushEndpointProblem(bad,), bad,).not.toBeNull();
    },);
},);
