/**
 * Media storage settings (`/admin/media/settings`, admin-only).
 *
 * Where uploaded files are stored and, separately, the public URL they are
 * SERVED from. Those two are different things and conflating them is the usual
 * mistake: the S3 endpoint is a write API, while a CDN domain in front of the
 * bucket is what visitors should hit.
 *
 * Environment variables still win over anything saved here, so an existing
 * deployment configured through `.env` is unaffected and an operator can keep
 * object-store credentials out of the database if they prefer.
 */
import { A, } from '@solidjs/router';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import type { MediaStorageSettings, } from '@sitesurge/types';
import { FormField, } from '../../components/admin/forms';
import VideoSettingsPanel from '../../components/admin/settings/VideoSettingsPanel';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import { useToast, } from '../../components/common/toast';
import { cms, } from '../../services/cmsClient';
import AdminTitle from '../../components/admin/common/AdminTitle';

const AdminMediaSettings: Component = () => {
    const toast = useToast();
    const [cfg, setCfg,] = createSignal<MediaStorageSettings | null>(null,);
    const [saving, setSaving,] = createSignal(false,);
    const [testing, setTesting,] = createSignal(false,);

    onMount(async () => {
        try { setCfg(await cms.settings.getMediaStorage() as MediaStorageSettings,); }
        catch { /* error bus */ }
    },);

    const patch = (p: Partial<MediaStorageSettings>,) => setCfg({ ...(cfg() as MediaStorageSettings), ...p, },);
    const patchS3 = (p: Partial<MediaStorageSettings['s3']>,) =>
        patch({ s3: { ...(cfg()!.s3 ?? {}), ...p, }, },);

    const save = async () => {
        setSaving(true,);
        try {
            setCfg(await cms.settings.setMediaStorage(cfg() as never,) as MediaStorageSettings,);
            toast.success('Media storage saved.',);
        } catch { /* error bus */ } finally { setSaving(false,); }
    };

    const test = async () => {
        setTesting(true,);
        try {
            const r = await cms.settings.testMediaStorage();
            if (r.ok) toast.success(r.detail || 'Storage is writable.',);
            else toast.error(r.detail || 'Storage test failed.',);
        } catch { /* error bus */ } finally { setTesting(false,); }
    };

    return (
        <div class="media-settings-page">
            <AdminTitle>Media Settings</AdminTitle>

            <div class="admin-header">
                <A href="/admin/media" class="admin-header__back">&larr; Media</A>
                <h1>Media Settings</h1>
                <div class="admin-header__actions">
                    <button class="ui-button ui-button--primary" onClick={save} disabled={saving() || !cfg()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={cfg()} fallback={<div class="empty-state">Loading…</div>}>
                {(c,) => (
                    <section class="admin-section">
                        <header class="admin-section__header">
                            <h2>Storage</h2>
                            <p class="form-help-muted">
                                Where uploaded images and documents are kept. Changing this does
                                not move existing files — their URLs are stored with each media
                                record, so copy the files across before switching.
                            </p>
                        </header>

                        <div class="admin-section__body">
                            <FormField label="Provider">
                                <select
                                    value={c().provider}
                                    onChange={(e,) => patch({ provider: e.currentTarget.value as never, },)}
                                >
                                    <option value="local">Server filesystem</option>
                                    <option value="s3">S3-compatible (AWS S3, Cloudflare R2, Backblaze, Spaces, MinIO)</option>
                                </select>
                            </FormField>

                            <Show when={c().provider === 'local'}>
                                <FormField label="Upload folder" hint="Absolute path on the server.">
                                    <input
                                        type="text"
                                        value={c().localDir ?? ''}
                                        placeholder="/var/www/uploads"
                                        onBlur={(e,) => patch({ localDir: e.currentTarget.value, },)}
                                    />
                                </FormField>
                            </Show>

                            <Show when={c().provider === 's3'}>
                                <FormField
                                    label="S3 API endpoint"
                                    hint="The WRITE API. Required for R2 and similar; leave blank for AWS S3."
                                >
                                    <input
                                        type="text"
                                        value={c().s3?.endpoint ?? ''}
                                        placeholder="https://<account-id>.r2.cloudflarestorage.com"
                                        onBlur={(e,) => patchS3({ endpoint: e.currentTarget.value, },)}
                                    />
                                </FormField>
                                <div class="admin-form-row-2">
                                    <FormField label="Bucket">
                                        <input
                                            type="text"
                                            value={c().s3?.bucket ?? ''}
                                            placeholder="my-media"
                                            onBlur={(e,) => patchS3({ bucket: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                    <FormField label="Region" hint="Use `auto` for Cloudflare R2.">
                                        <input
                                            type="text"
                                            value={c().s3?.region ?? ''}
                                            placeholder="auto"
                                            onBlur={(e,) => patchS3({ region: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                </div>
                                <div class="admin-form-row-2">
                                    <FormField label="Access key ID">
                                        <input
                                            type="text"
                                            value={c().s3?.accessKeyId ?? ''}
                                            onBlur={(e,) => patchS3({ accessKeyId: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                    <FormField
                                        label="Secret access key"
                                        hint="Stored server-side and never sent back to the browser."
                                    >
                                        <input
                                            type="password"
                                            value={c().s3?.secretAccessKey ?? ''}
                                            onBlur={(e,) => patchS3({ secretAccessKey: e.currentTarget.value, },)}
                                        />
                                    </FormField>
                                </div>
                                <FormField
                                    label="Public CDN URL"
                                    hint="Where visitors LOAD files from — a custom domain in front of the bucket. Not the API endpoint above."
                                >
                                    <input
                                        type="text"
                                        value={c().s3?.cdnUrl ?? ''}
                                        placeholder="https://cdn.example.com"
                                        onBlur={(e,) => patchS3({ cdnUrl: e.currentTarget.value, },)}
                                    />
                                </FormField>
                            </Show>

                            <div class="backup-panel__actions">
                                <button class="ui-button ui-button--secondary" onClick={test} disabled={testing()}>
                                    {testing() ? 'Testing…' : 'Test connection'}
                                </button>
                            </div>

                            <p class="form-help">
                                Environment variables (<code>STORAGE_PROVIDER</code>,{' '}
                                <code>S3_BUCKET</code>, <code>S3_CDN_URL</code>…) override anything
                                saved here, so a server configured through <code>.env</code> keeps
                                working unchanged.
                            </p>
                        </div>
                    </section>
                )}
            </Show>

            <Show when={isFeatureEnabled('video',)}>
                <VideoSettingsPanel />
            </Show>
        </div>
    );
};

export default AdminMediaSettings;
