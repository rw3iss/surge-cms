import { randomUUID, } from 'node:crypto';

/**
 * Generate a real UUID for a client-supplied block id. The CMS lets an admin
 * (or an API-key client) supply block ids on create so a child block can
 * reference its parent before either has been persisted — essential for
 * building group → group_item → child trees in a single logical operation.
 */
export function newBlockId(): string {
    return randomUUID();
}
