/** Registered social analytics collectors (one per platform). */
import type { SocialAnalyticsCollector, } from './types';

const collectors = new Map<string, SocialAnalyticsCollector>();

export function registerCollector(c: SocialAnalyticsCollector,): void {
    collectors.set(c.platform, c,);
}

export function getCollector(platform: string,): SocialAnalyticsCollector | undefined {
    return collectors.get(platform,);
}

export function listCollectors(): SocialAnalyticsCollector[] {
    return [...collectors.values(),];
}
