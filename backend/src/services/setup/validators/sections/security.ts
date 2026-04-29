import { z, } from 'zod';

export const securitySchema = z.object({
    jwtSecret: z.string().min(32, 'JWT secret must be at least 32 characters',),
    accessTokenExpires: z.string().optional(),
    refreshTokenExpires: z.string().optional(),
},);
