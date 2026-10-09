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
        key: '100ms',
        label: '100ms',
        description: 'WebRTC live rooms with browser publishing, HLS for large audiences, recording and on-stage guests.',
        website: 'https://www.100ms.live',
        docsUrl: 'https://www.100ms.live/docs',
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
