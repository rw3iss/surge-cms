/**
 * Sitemap operations panel — shown under Settings → Admin → Admin
 * Operations.
 *
 * The sitemap auto-rebuilds whenever a page, post, campaign, or form
 * changes (services/cache.ts invalidates the `sitemap:xml` Redis key,
 * and the next public request rebuilds it). This panel exposes a
 * manual rebuild for the rare cases that need an immediate refresh
 * (e.g. after a bulk DB import) and a deep link to the live route.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { api, } from '../../../services/api';
import { useToast, } from '../../common/toast';

interface SitemapInfo {
    urlCount: number;
    bytes: number;
    regeneratedAt: string;
}

const SitemapPanel: Component = () => {
    const toast = useToast();
    const [busy, setBusy,] = createSignal(false,);
    const [info, setInfo,] = createSignal<SitemapInfo | null>(null,);

    const regenerate = async () => {
        setBusy(true,);
        try {
            const response = await api.post('/admin/sitemap/regenerate', {},);
            if (response.success) {
                const data = (response as any).data as SitemapInfo;
                setInfo(data,);
                toast.success(
                    `Sitemap rebuilt: ${data.urlCount} URLs (${(data.bytes / 1024).toFixed(1,)} KB)`,
                );
            } else {
                toast.error('Failed to regenerate sitemap',);
            }
        } catch (err: any) {
            toast.error(err?.message || 'Failed to regenerate sitemap',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="settings-card">
            <div class="settings-card__title">Sitemap</div>
            <p class="settings-card__lede">
                Auto-rebuilds when pages, posts, campaigns, or forms change.
                Use the button to force a rebuild now (drops the Redis cache
                and re-queries the database).
            </p>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', 'flex-wrap': 'wrap', }}>
                <button
                    class="btn btn--secondary"
                    onClick={regenerate}
                    disabled={busy()}
                >
                    {busy() ? 'Regenerating…' : 'Regenerate sitemap'}
                </button>
                <a
                    href="/sitemap.xml"
                    target="_blank"
                    rel="noopener"
                    class="btn btn--ghost btn--small"
                >
                    View /sitemap.xml ↗
                </a>
                <Show when={info()}>
                    {(d,) => (
                        <span class="form-help-muted" style={{ margin: 0, }}>
                            {d().urlCount} URLs · {(d().bytes / 1024).toFixed(1,)} KB ·
                            rebuilt {new Date(d().regeneratedAt,).toLocaleTimeString()}
                        </span>
                    )}
                </Show>
            </div>
        </div>
    );
};

export default SitemapPanel;
