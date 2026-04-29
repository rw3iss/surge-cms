import { z, } from 'zod';

export const generalSchema = z.object({
    siteName: z.string().min(1, 'Site name is required',).max(100, 'Site name is too long',),
    siteTagline: z.string().max(160, 'Tagline is too long',).optional(),
    uploadMaxSizeMb: z.number().int().positive().max(10_000,),
    uploadDir: z.string().min(1, 'Upload directory is required',),
    dataDir: z.string().min(1, 'Data directory is required',),
},);
