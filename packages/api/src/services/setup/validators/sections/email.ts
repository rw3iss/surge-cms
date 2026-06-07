import { z, } from 'zod';

export const emailSchema = z.object({
    enabled: z.boolean(),
    host: z.string().optional(),
    port: z.number().int().min(1,).max(65535,).optional(),
    secure: z.boolean().optional(),
    user: z.string().optional(),
    pass: z.string().optional(),
    from: z.string().optional(),
},).superRefine((value, ctx,) => {
    if (!value.enabled) return;
    if (!value.host) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['host',], message: 'SMTP host required', },);
    if (!value.port) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['port',], message: 'SMTP port required', },);
    if (!value.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from',], message: '"From" address required', },);
},);
