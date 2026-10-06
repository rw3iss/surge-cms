/**
 * Plugin system types. Plugins are admin-installable extensions living in a
 * host `plugins/` directory — modeled on the Features module system but over an
 * open, data-driven set. See docs/plans/superpowers/specs/2026-07-13-plugin-system-design.md.
 */

export type PluginCapability = 'public-widget' | 'admin-widget' | 'config-page' | 'api-routes';

export type PluginSource = 'manual' | 'upload' | 'marketplace';

/** Field types for the host-rendered declarative config form. */
export type PluginConfigFieldType =
    | 'string' | 'url' | 'number' | 'boolean' | 'select' | 'secret' | 'textarea';

/** A single config field a plugin declares in its manifest `configSchema`. */
export interface PluginConfigField {
    key: string;
    label: string;
    type: PluginConfigFieldType;
    required?: boolean;
    default?: string | number | boolean;
    /** Options for `select`. */
    options?: string[];
    help?: string;
    /** Group heading to bucket fields in the rendered form. */
    group?: string;
    /** Secret fields are never included in the public plugin projection. */
    secret?: boolean;
}

/** Parsed `plugin.json`. */
export interface PluginManifest {
    name: string;
    label: string;
    description?: string;
    version: string;
    author?: string;
    homepage?: string;
    /** Plugin API contract version the host validates for compatibility. */
    apiVersion: number;
    /** Node entry (relative to the plugin dir), e.g. "server.js". */
    server?: string;
    /** Browser ESM entry (relative), e.g. "client.js". */
    client?: string;
    capabilities?: PluginCapability[];
    /** Whether the plugin exposes the "admins only" visibility toggle. */
    adminOnlyToggle?: boolean;
    configSchema?: PluginConfigField[];
    /**
     * Extra Content-Security-Policy origins the plugin's widget needs, merged
     * into the host CSP while the plugin is enabled. Origins of `type:'url'`
     * config values are added to `connect-src` automatically — declare here
     * only static origins the config doesn't cover (e.g. a CDN the widget
     * pulls scripts / styles / images / iframes from).
     */
    csp?: PluginCsp;
}

export interface PluginCsp {
    connectSrc?: string[];
    scriptSrc?: string[];
    styleSrc?: string[];
    imgSrc?: string[];
    frameSrc?: string[];
}

/** A plugin as stored + surfaced to the admin API. */
export interface Plugin {
    id: string;
    name: string;
    label: string;
    /** Version present on disk (from the manifest). */
    version: string;
    /** Version the last successful install()/update() ran for (null = not installed). */
    installedVersion: string | null;
    source: PluginSource;
    /** Path relative to PLUGINS_DIR. */
    location: string;
    installed: boolean;
    enabled: boolean;
    config: Record<string, unknown>;
    manifest: PluginManifest;
    /** Disk version > installedVersion → an update is available. */
    updateAvailable: boolean;
    /** The plugin's server module implements an `update()` hook, so it can be
     *  re-synced/updated on demand even without a version bump. */
    hasUpdateHook: boolean;
    /** Last load/install error, surfaced as the table status. */
    error: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * Public projection the running site loads (no secrets, no server internals).
 * Served by the inherent public `GET /plugins/enabled` endpoint.
 */
export interface PublicPlugin {
    name: string;
    label: string;
    version: string;
    capabilities: PluginCapability[];
    /** Same-origin URL to the plugin's browser bundle, or null if none. */
    clientUrl: string | null;
    /** Public-safe config subset (secret fields stripped). */
    config: Record<string, unknown>;
    /** Widget renders only for signed-in admins when true. */
    adminOnly: boolean;
}

/** A marketplace search result (stubbed in v1). */
export interface MarketplacePlugin {
    id: string;
    name: string;
    label: string;
    description: string;
    version: string;
    author?: string;
    homepage?: string;
    installed: boolean;
}

/** What an update() hook reports back. */
export interface PluginUpdateResult {
    fromVersion: string;
    toVersion: string;
    migrated: boolean;
    notes?: string;
}
