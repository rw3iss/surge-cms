import { createSignal, onMount, Show, } from 'solid-js';
import ColorPicker from '../../appearance/ColorPicker';
import { cms, } from '../../../../services/cmsClient';
import { reloadAdminAppearance, } from '../../../../stores/adminAppearance';
import ThemeField from './ThemeField';

// ─── Admin Appearance Panel ───
//
// Color tokens scoped to the admin chrome — sidebar bg/text, page
// bg/text, and panel background. Backed by `site_settings.admin_appearance`
// (see backend GET/PUT /settings/admin-appearance). Each field is
// optional; unset values fall back to the static admin theme via
// `var(--admin-x, fallback)` in AdminLayout.scss.

export default function AdminAppearancePanel() {
    const [sidebarBg, setSidebarBg,] = createSignal('',);
    const [sidebarText, setSidebarText,] = createSignal('',);
    const [pageBg, setPageBg,] = createSignal('',);
    const [pageText, setPageText,] = createSignal('',);
    const [panelBg, setPanelBg,] = createSignal('',);
    const [panelText, setPanelText,] = createSignal('',);
    const [panelBorder, setPanelBorder,] = createSignal('',);
    const [inputBg, setInputBg,] = createSignal('',);
    const [inputText, setInputText,] = createSignal('',);

    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const markDirty = () => { setIsDirty(true,); setSuccess(false,); };

    onMount(async () => {
        try {
            const d = await cms.settings.getAdminAppearance() as any;
            if (d) {
                setSidebarBg(d.sidebarBg || '',);
                setSidebarText(d.sidebarText || '',);
                setPageBg(d.pageBg || '',);
                setPageText(d.pageText || '',);
                setPanelBg(d.panelBg || '',);
                setPanelText(d.panelText || '',);
                setPanelBorder(d.panelBorder || '',);
                setInputBg(d.inputBg || '',);
                setInputText(d.inputText || '',);
            }
        } catch (e) {
            console.error('Failed to load admin appearance:', e,);
        }
    },);

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        setSuccess(false,);
        try {
            await cms.settings.adminAppearance({
                sidebarBg: sidebarBg() || undefined,
                sidebarText: sidebarText() || undefined,
                pageBg: pageBg() || undefined,
                pageText: pageText() || undefined,
                panelBg: panelBg() || undefined,
                panelText: panelText() || undefined,
                panelBorder: panelBorder() || undefined,
                inputBg: inputBg() || undefined,
                inputText: inputText() || undefined,
            } as any,);
            // Refresh the in-memory store so the chrome updates
            // without a hard reload — same pattern as the public
            // appearance / site-settings stores.
            await reloadAdminAppearance();
            setIsDirty(false,);
            setSuccess(true,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save admin appearance',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div class="appearance-panel admin-appearance-panel">
            <div class="appearance-panel__action-bar">
                <button class="ui-button ui-button--primary" onClick={handleSave} disabled={!isDirty() || saving()}>
                    {saving() ? 'Saving...' : 'Save Admin Appearance'}
                </button>
                <Show when={success()}>
                    <span class="appearance-panel__saved">Saved.</span>
                </Show>
            </div>

            <Show when={error()}>
                <div class="alert alert--error" style={{ 'margin-bottom': '1rem', }}>{error()}</div>
            </Show>

            <div class="settings-grid settings-grid--equal">
                {/* Left column: Sidebar on top, Inputs below — both
                    nav-chrome controls live in one stack so the
                    Page-area card on the right can occupy a single
                    tall column without breaking responsive fallback.
                    `--equal` makes the two columns 50/50 instead of the
                    default 3:2 used by other settings tabs. */}
                <div class="settings-grid__col">
                    <section class="settings-card">
                        <h3 class="settings-card__title">Sidebar</h3>
                        <p class="settings-card__lede">
                            Colors applied to the left admin sidebar — background, links, icons, and the
                            site name displayed at the top.
                        </p>

                        <ThemeField
                            label="Sidebar background"
                            sublabel="Background of the left sidebar"
                        >
                            <ColorPicker
                                value={sidebarBg()}
                                onChange={(hex,) => { setSidebarBg(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setSidebarBg('',); markDirty(); }}
                            />
                        </ThemeField>

                        <ThemeField
                            label="Sidebar text & icons"
                            sublabel="Color for sidebar nav text and icons"
                        >
                            <ColorPicker
                                value={sidebarText()}
                                onChange={(hex,) => { setSidebarText(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setSidebarText('',); markDirty(); }}
                            />
                        </ThemeField>
                    </section>

                    <section class="settings-card">
                        <h3 class="settings-card__title">Inputs</h3>
                        <p class="settings-card__lede">
                            Background and text color used by all admin inputs, selects, and textareas.
                        </p>

                        <ThemeField
                            label="Input background"
                            sublabel="Background of inputs / selects / textareas"
                        >
                            <ColorPicker
                                value={inputBg()}
                                onChange={(hex,) => { setInputBg(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setInputBg('',); markDirty(); }}
                            />
                        </ThemeField>

                        <ThemeField
                            label="Input text"
                            sublabel="Text color inside inputs / selects / textareas"
                        >
                            <ColorPicker
                                value={inputText()}
                                onChange={(hex,) => { setInputText(hex,); markDirty(); }}
                                clearable
                                onClear={() => { setInputText('',); markDirty(); }}
                            />
                        </ThemeField>
                    </section>
                </div>

                <section class="settings-card">
                    <h3 class="settings-card__title">Page area</h3>
                    <p class="settings-card__lede">
                        The right-hand content area where each admin page renders.
                    </p>

                    <ThemeField
                        label="Page background"
                        sublabel="Background of the admin content area"
                    >
                        <ColorPicker
                            value={pageBg()}
                            onChange={(hex,) => { setPageBg(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPageBg('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Page text"
                        sublabel="Default text color for admin pages"
                    >
                        <ColorPicker
                            value={pageText()}
                            onChange={(hex,) => { setPageText(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPageText('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel background"
                        sublabel="Card / section panel background color"
                    >
                        <ColorPicker
                            value={panelBg()}
                            onChange={(hex,) => { setPanelBg(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelBg('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel text"
                        sublabel="Text color inside panels (cards, dashboard sections, tables)"
                    >
                        <ColorPicker
                            value={panelText()}
                            onChange={(hex,) => { setPanelText(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelText('',); markDirty(); }}
                        />
                    </ThemeField>

                    <ThemeField
                        label="Panel border"
                        sublabel="Border color around panels (cards, sections, tables)"
                    >
                        <ColorPicker
                            value={panelBorder()}
                            onChange={(hex,) => { setPanelBorder(hex,); markDirty(); }}
                            clearable
                            onClear={() => { setPanelBorder('',); markDirty(); }}
                        />
                    </ThemeField>
                </section>
            </div>
        </div>
    );
}
