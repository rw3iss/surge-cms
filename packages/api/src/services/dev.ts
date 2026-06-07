/**
 * Dev service — exposes the in-process cron registry for the admin
 * developer tools. Pure registry reads; no DB or side-effects.
 */
import { cronRegistry, } from './cron';

export function listCrons() {
    return cronRegistry.list();
}

export function getCron(name: string,) {
    return cronRegistry.getJob(name,) ?? null;
}
