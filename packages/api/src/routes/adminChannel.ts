/**
 * Admin Channel REST surface — a staff-only snapshot of current presence
 * (connected admin/editor users) + the configured idle timeout. The live
 * updates flow over the WebSocket at `/ws/admin`; this endpoint is a fallback /
 * initial fetch and keeps the channel represented in the route manifest.
 */
import { defineRoute, } from '../api/defineRoute';
import { getActiveTimeoutMs, } from '../services/adminChannel/config';
import * as registry from '../services/adminChannel/registry';

export const adminChannelRoutes = [
    defineRoute({
        method: 'get', path: '/presence', auth: 'staff',
        summary: 'Current admin-channel presence (connected admin/editor users)',
        handler: async () => ({
            users: await registry.roster(),
            activeTimeoutMs: await getActiveTimeoutMs(),
        }),
    },),
];
