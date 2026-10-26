import { getSystemPage, } from '@sitesurge/types';
import { Component, JSX, lazy, onMount, Show, } from 'solid-js';
import { isFeatureEnabled, loadSiteSettings, siteSettings, } from '../../stores/siteSettings';

const DynamicPage = lazy(() => import('../../pages/DynamicPage'));

/**
 * The slug of the published CMS page set to "Use as page: <key>", else null.
 * Read from the public settings (`systemPages`), so no request per navigation.
 */
export function systemPageSlug(key: string,): string | null {
    const def = getSystemPage(key,);
    if (!def || (def.feature && !isFeatureEnabled(def.feature,))) return null;
    return siteSettings()?.systemPages?.[key] ?? null;
}

/**
 * A built-in route that a CMS page may replace (registry: SYSTEM_PAGES in
 * `@sitesurge/types` utils/systemPages.ts). Renders that page at this URL when
 * one is set, otherwise the built-in screen (`children`). Waits for the public
 * settings so the built-in screen never flashes before the page.
 */
const SystemPageRoute: Component<{ pageKey: string; children: JSX.Element; }> = (props,) => {
    onMount(() => { void loadSiteSettings(); },);
    return (
        <Show when={siteSettings()}>
            <Show when={systemPageSlug(props.pageKey,)} keyed fallback={props.children}>
                {(slug,) => <DynamicPage slugOverride={slug} canonicalPath={getSystemPage(props.pageKey,)?.path} />}
            </Show>
        </Show>
    );
};

export default SystemPageRoute;
