#!/usr/bin/env node
/**
 * One-off bucket setup for direct uploads + HLS playback (video feature):
 *   - CORS: browser PUTs of upload parts (needs ETag exposed) and hls.js GETs
 *   - Lifecycle: abort incomplete multipart uploads after 7 days; delete
 *     objects under incoming/ after 14 days (abandoned uploads)
 *
 * Reads the bucket credentials from the environment (S3_ENDPOINT, S3_BUCKET,
 * AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION) — run from
 * packages/api so `.env` loads:
 *
 *   node scripts/r2-video-setup.mjs https://example.com https://www.example.com
 *
 * Origins default to FRONTEND_URL + CORS_ORIGINS. Prints no secrets.
 * Use --dry-run to print the configuration only.
 */
import 'dotenv/config';
import {
    GetBucketCorsCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, S3Client,
} from '@aws-sdk/client-s3';

const args = process.argv.slice(2,);
const dry = args.includes('--dry-run',);
const extra = args.filter((a,) => /^https?:\/\//.test(a,));
const env = process.env;
const origins = [...new Set([
    ...extra,
    env.FRONTEND_URL,
    ...(env.CORS_ORIGINS || '').split(',',),
].map((o,) => (o || '').trim().replace(/\/+$/, '',)).filter((o,) => /^https?:\/\//.test(o,)),),];

if (!env.S3_BUCKET) {
    console.error('S3_BUCKET is not set (run from packages/api with the server .env).',);
    process.exit(1,);
}

const cors = {
    CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'HEAD', 'PUT',],
        AllowedHeaders: ['*',],
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges',],
        MaxAgeSeconds: 86400,
    },],
};
const lifecycle = {
    Rules: [
        { ID: 'abort-incomplete-multipart', Status: 'Enabled', Filter: { Prefix: '', }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7, }, },
        { ID: 'expire-incoming', Status: 'Enabled', Filter: { Prefix: 'incoming/', }, Expiration: { Days: 14, }, },
    ],
};

console.log(`Bucket: ${env.S3_BUCKET}\nOrigins: ${origins.join(', ',)}`,);
if (dry) {
    console.log(JSON.stringify({ cors, lifecycle, }, null, 2,),);
    process.exit(0,);
}

const client = new S3Client({
    region: env.AWS_REGION || 'auto',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: env.AWS_ACCESS_KEY_ID ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '', } : undefined,
},);

try {
    await client.send(new PutBucketCorsCommand({ Bucket: env.S3_BUCKET, CORSConfiguration: cors, },),);
    const now = await client.send(new GetBucketCorsCommand({ Bucket: env.S3_BUCKET, },),);
    console.log('CORS set:', JSON.stringify(now.CORSRules,),);
} catch (e) {
    console.error(`CORS failed: ${e.name}: ${e.message}`,);
    process.exitCode = 1;
}
try {
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: env.S3_BUCKET, LifecycleConfiguration: lifecycle, },),);
    console.log('Lifecycle set: abort incomplete multipart after 7 days; incoming/ expires after 14 days',);
} catch (e) {
    console.error(`Lifecycle failed: ${e.name}: ${e.message}`,);
    process.exitCode = 1;
}
