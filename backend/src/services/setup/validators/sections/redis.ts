import { z, } from 'zod';

export const redisSchema = z.object({
    enabled: z.boolean(),
    url: z.string().optional(),
    cacheTtlSeconds: z.number().int().min(0,).max(86_400,).optional(),
},).superRefine((value, ctx,) => {
    if (value.enabled && !value.url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url',], message: 'Redis URL is required when enabled', },);
    }
},);
