import { z, } from 'zod';

const componentFields = z.object({
    host: z.string().min(1,),
    port: z.number().int().min(1,).max(65535,),
    database: z.string().min(1,),
    user: z.string().min(1,),
    password: z.string(),
},);

export const databaseSchema = z.object({
    mode: z.enum(['existing', 'create',],),
    url: z.string().url().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1,).max(65535,).optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    createRole: z.boolean().optional(),
    createDatabase: z.boolean().optional(),
    superuser: z.object({
        user: z.string().min(1,),
        password: z.string(),
        host: z.string().optional(),
        port: z.number().int().min(1,).max(65535,).optional(),
    },).optional(),
},).superRefine((value, ctx,) => {
    // Either `url` OR all component fields must be present.
    if (!value.url) {
        const partial = {
            host: value.host,
            port: value.port,
            database: value.database,
            user: value.user,
            password: value.password ?? '',
        };
        const r = componentFields.safeParse(partial,);
        if (!r.success) {
            for (const issue of r.error.issues) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: issue.path,
                    message: issue.message,
                },);
            }
        }
    }
    // Superuser is required whenever any provisioning is requested. The
    // 'create' mode is shorthand for both flags being true.
    const provisioning = value.createRole || value.createDatabase || value.mode === 'create';
    if (provisioning && !value.superuser) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['superuser',],
            message: 'Superuser credentials are required to create the database or role',
        },);
    }
},);
