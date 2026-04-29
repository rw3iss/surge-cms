import { z, } from 'zod';

export const adminUserSchema = z.object({
    enabled: z.boolean(),
    email: z.string().email('Invalid email address',).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters',).optional(),
    confirmPassword: z.string().optional(),
    displayName: z.string().max(100,).optional(),
},).superRefine((value, ctx,) => {
    if (!value.enabled) return;
    if (!value.email) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email',], message: 'Email is required',},);
    }
    if (!value.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password',], message: 'Password is required',},);
    }
    if (value.password && value.password !== value.confirmPassword) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword',], message: 'Passwords do not match',},);
    }
},);
