/**
 * Build the rendering context that the mail renderer needs from
 * `site_settings`: site name + URL plus the swatch palette (id → hex).
 * Both the preview endpoint and the send route call this — same query,
 * same shape, so it lives once.
 */
import { query, } from '../../db';

export interface MailRenderContext {
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;
}

export async function loadMailRenderContext(): Promise<MailRenderContext> {
    const res = await query<{ key: string; value: unknown; }>(
        `SELECT key, value FROM site_settings`,
    );
    const settings: Record<string, unknown> = {};
    for (const row of res.rows) settings[row.key] = row.value;

    const palette: Record<string, string> = {};
    const rawSwatches = settings.site_colors;
    if (Array.isArray(rawSwatches,)) {
        for (const s of rawSwatches as Array<{ id?: unknown; hex?: unknown; }>) {
            if (typeof s.id === 'string' && typeof s.hex === 'string') {
                palette[s.id] = s.hex;
            }
        }
    }

    return {
        siteName: (settings.site_name as string) ?? 'Site',
        siteUrl: (settings.site_url as string) ?? '',
        palette,
    };
}
