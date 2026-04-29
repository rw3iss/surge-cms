import { z, } from 'zod';

export const storageSchema = z.object({
    provider: z.enum(['local', 's3',],),
    s3: z.object({
        region: z.string().min(1,),
        accessKeyId: z.string().min(1,),
        secretAccessKey: z.string().min(1,),
        bucket: z.string().min(1,),
        cdnUrl: z.string().url().optional(),
    },).optional(),
},).superRefine((value, ctx,) => {
    if (value.provider === 's3' && !value.s3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['s3',], message: 'S3 credentials are required when provider is s3', },);
    }
},);
