import { z, } from 'zod';
import { adminUserSchema, } from './sections/adminUser';
import { databaseSchema, } from './sections/database';
import { emailSchema, } from './sections/email';
import { generalSchema, } from './sections/general';
import { redisSchema, } from './sections/redis';
import { securitySchema, } from './sections/security';
import { storageSchema, } from './sections/storage';
import type { SectionKey, } from '../types';
import type { ValidationIssue, } from '../../../core/types/installation';

export const installInputSchema = z.object({
    general: generalSchema,
    database: databaseSchema,
    adminUser: adminUserSchema,
    redis: redisSchema,
    storage: storageSchema,
    security: securitySchema,
    email: emailSchema,
    includeSampleContent: z.boolean().optional(),
},);

/**
 * Convert zod issues into the wizard's ValidationIssue contract. The
 * leading path segment becomes the section key; the rest becomes the
 * dotted field path. This is what lets the frontend put errors next to
 * the right input.
 */
export function zodErrorToIssues(err: z.ZodError,): ValidationIssue[] {
    return err.issues.map((issue,) => {
        const path = issue.path.map(String,);
        const section = (path[0] as SectionKey) ?? '_global';
        const field = path.slice(1,).join('.',) || undefined;
        return {
            section,
            field,
            message: issue.message,
            code: issue.code,
        };
    },);
}
