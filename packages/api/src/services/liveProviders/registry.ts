/**
 * Live-stream provider CATALOGUE. Each provider is one descriptor here (its
 * config fields drive the admin form) plus — once implemented — a server
 * adapter and a browser adapter behind the shared provider interface (see the
 * research doc docs/plans/2026-10-09-live-stream-providers.md).
 *
 * Add a provider: append a descriptor; set `implemented` when its adapters
 * exist. Nothing else in the admin needs to change.
 */
import type { LiveProviderDescriptor, } from '@sitesurge/types';

export const LIVE_PROVIDERS: LiveProviderDescriptor[] = [
    {
        key: 'livekit',
        label: 'LiveKit (recommended)',
        description: 'Open-source WebRTC SFU — LiveKit Cloud now, self-hostable later with the same API. Host + up to 3 guests publish from the browser; small audiences watch over WebRTC (<1 s), large ones over HLS written straight into our R2 bucket, which is also the recording.',
        website: 'https://livekit.io',
        docsUrl: 'https://docs.livekit.io',
        pricingNote: 'Research 2026-10-09: 1 h show / 500 viewers ≈ $0 extra with HLS from R2 (≈ $60 if all watch over WebRTC); Ship plan $50/month. See docs/plans/2026-10-09-live-stream-providers.md.',
        capabilities: {
            browserPublish: true, webrtcViewing: true, hlsViewing: true, recording: true,
            recordingToOwnBucket: true, guests: true,
        },
        implemented: false,
        fields: [
            {
                key: 'url', label: 'Server URL', type: 'url', required: true, placeholder: 'wss://your-project.livekit.cloud',
                help: 'LiveKit Cloud project URL, or your self-hosted server.',
            },
            { key: 'apiKey', label: 'API key', type: 'text', required: true, },
            {
                key: 'apiSecret', label: 'API secret', type: 'secret', required: true,
                help: 'Signs host, guest and viewer tokens on this server. Never sent to browsers.',
            },
            {
                key: 'viewerMode', label: 'Viewer delivery', type: 'select', default: 'auto',
                options: [
                    { value: 'auto', label: 'Auto — WebRTC while small, HLS from R2 when large', },
                    { value: 'hls', label: 'HLS from R2 — any audience, ~5–10 s delay, no viewer fees', },
                    { value: 'webrtc', label: 'WebRTC — sub-second, billed per viewer-minute', },
                ],
            },
            {
                key: 'egressLayout', label: 'Recording / HLS layout', type: 'select', default: 'speaker',
                options: [
                    { value: 'speaker', label: 'Speaker', },
                    { value: 'grid', label: 'Grid', },
                    { value: 'single-speaker', label: 'Single speaker', },
                ],
            },
            {
                key: 'recordToBucket', label: 'Record into our storage (R2)', type: 'toggle', default: true,
                help: 'Segmented HLS egress into the Media → Settings bucket; becomes the replay when the show ends.',
            },
            { key: 'webhookSecret', label: 'Webhook signing key', type: 'secret', help: 'Usually the API secret; verifies room / egress events.', },
        ],
    },
    {
        key: 'cloudflare_stream',
        label: 'Cloudflare Stream',
        description: 'Cloudflare-native: browser shows over WebRTC (WHIP in, WHEP out, <0.5 s), or OBS over RTMPS with automatic recording and signed HLS. Note: a browser (WebRTC) show is not recorded by Cloudflare — the host browser records and uploads it.',
        website: 'https://developers.cloudflare.com/stream/',
        docsUrl: 'https://developers.cloudflare.com/stream/webrtc-beta/',
        pricingNote: 'Research 2026-10-09: 1 h show / 500 viewers ≈ $30; 4 shows × 200 viewers ≈ $48/month ($1 per 1,000 WebRTC viewer-minutes from 2026-10-15).',
        capabilities: {
            browserPublish: true, webrtcViewing: true, hlsViewing: true, recording: true,
            recordingToOwnBucket: false, guests: false,
        },
        implemented: false,
        fields: [
            { key: 'accountId', label: 'Account ID', type: 'text', required: true, },
            { key: 'apiToken', label: 'API token', type: 'secret', required: true, help: 'Token with Stream:Edit.', },
            {
                key: 'customerSubdomain', label: 'Customer subdomain', type: 'text', required: true,
                placeholder: 'customer-xxxx.cloudflarestream.com',
            },
            {
                key: 'recordingMode', label: 'Mode', type: 'select', default: 'browser',
                options: [
                    { value: 'browser', label: 'Browser (WebRTC) — host browser records + uploads the replay', },
                    { value: 'rtmps', label: 'OBS / RTMPS — Cloudflare records automatically', },
                ],
            },
            { key: 'signingKeyId', label: 'Signing key ID', type: 'text', help: 'For signed (subscriber-only) playback URLs.', },
            { key: 'signingKeyJwk', label: 'Signing key (JWK)', type: 'secret', },
            { key: 'webhookSecret', label: 'Webhook secret', type: 'secret', },
        ],
    },
    {
        key: '100ms',
        label: '100ms',
        description: 'WebRTC live rooms with browser publishing, HLS for large audiences, recording and on-stage guests.',
        website: 'https://www.100ms.live',
        docsUrl: 'https://www.100ms.live/docs',
        pricingNote: 'Research 2026-10-09: 1 h show / 500 viewers ≈ $24 after free minutes; 4 shows × 200 viewers ≈ $46/month.',
        capabilities: {
            browserPublish: true, webrtcViewing: true, hlsViewing: true, recording: true,
            recordingToOwnBucket: true, guests: true,
        },
        implemented: false,
        fields: [
            {
                key: 'accessKey', label: 'App access key', type: 'text', required: true,
                help: '100ms dashboard → Developer → Access credentials.',
            },
            {
                key: 'appSecret', label: 'App secret', type: 'secret', required: true,
                help: 'Signs host and viewer tokens on this server. Never sent to browsers.',
            },
            {
                key: 'templateId', label: 'Template ID', type: 'text', required: true,
                help: 'The room template with the roles below (Dashboard → Templates).',
            },
            { key: 'hostRole', label: 'Host role', type: 'text', default: 'broadcaster', placeholder: 'broadcaster', },
            { key: 'guestRole', label: 'Guest role', type: 'text', default: 'guest', placeholder: 'guest', },
            {
                key: 'viewerMode', label: 'Viewer delivery', type: 'select', default: 'hls',
                options: [
                    { value: 'hls', label: 'HLS — large audiences, ~5–10 s delay', },
                    { value: 'webrtc', label: 'WebRTC — sub-second, smaller audiences', },
                ],
            },
            { key: 'viewerRole', label: 'Viewer role', type: 'text', default: 'hls-viewer', placeholder: 'hls-viewer', },
            {
                key: 'recordToBucket', label: 'Record into our storage (R2)', type: 'toggle', default: true,
                help: 'Uses the bucket from Media → Settings; the recording then appears as a video post\'s media.',
            },
            {
                key: 'webhookSecret', label: 'Webhook secret', type: 'secret',
                help: 'Set the same value in 100ms → Developer → Webhooks (header); used to verify room/recording events.',
            },
        ],
    },
];

export function getLiveProvider(key: string | null | undefined,): LiveProviderDescriptor | undefined {
    return key ? LIVE_PROVIDERS.find((p,) => p.key === key) : undefined;
}

/** Required fields filled in? */
export function isLiveProviderConfigured(key: string | null | undefined, config: Record<string, unknown> | undefined,): boolean {
    const p = getLiveProvider(key,);
    if (!p || !config) return false;
    return p.fields.filter((f,) => f.required).every((f,) => {
        const v = config[f.key];
        return typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null;
    },);
}
