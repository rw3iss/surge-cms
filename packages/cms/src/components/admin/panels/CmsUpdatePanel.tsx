/**
 * CMS update panel — Settings → Admin → Admin Operations.
 *
 * Reports the installed CMS version vs. the latest published release, and
 * (when an update is available) lets the operator install it in one click.
 * Updating runs `npm install @sitesurge/*@latest` on the server and restarts
 * the process, so the site is briefly unavailable while it comes back. The
 * action is guarded by a confirmation modal; after the server restarts the
 * panel polls until it's healthy again and reloads to pick up the new admin.
 */
import { Component, createResource, createSignal, Match, Show, Switch, } from 'solid-js';
import type { SettingsCmsVersionResponse, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';

/** Rough operator-facing estimate of the restart window shown in the warning. */
const RESTART_ESTIMATE = 'about 30–60 seconds';

type Phase = 'idle' | 'updating' | 'restarting' | 'error';

const CmsUpdatePanel: Component = () => {
    const toast = useToast();
    const [info, { refetch, },] = createResource<SettingsCmsVersionResponse>(
        () => cms.settings.getCmsVersion(),
    );
    const [checking, setChecking,] = createSignal(false,);
    const [confirmOpen, setConfirmOpen,] = createSignal(false,);
    const [phase, setPhase,] = createSignal<Phase>('idle',);
    const [errorOutput, setErrorOutput,] = createSignal('',);

    const check = async () => {
        setChecking(true,);
        try {
            await refetch();
        } finally {
            setChecking(false,);
        }
    };

    /** Poll the version endpoint until the restarted server answers, then
     *  reload so the browser picks up the newly-installed admin build. */
    const waitForRestartThenReload = () => {
        let attempts = 0;
        const MAX_ATTEMPTS = 40; // ~2 minutes at 3s spacing
        const tick = async () => {
            attempts++;
            try {
                await cms.settings.getCmsVersion();
                // Server is back — reload to load the new admin assets.
                window.location.reload();
                return;
            } catch {
                if (attempts >= MAX_ATTEMPTS) {
                    setPhase('error',);
                    setErrorOutput(
                        'The server did not come back online within the expected time. '
                        + 'Check the server / supervisor status — it may still be restarting.',
                    );
                    return;
                }
                setTimeout(() => { void tick(); }, 3000,);
            }
        };
        // Wait past the server's ~1.5s exit delay before the first probe.
        setTimeout(() => { void tick(); }, 4000,);
    };

    const runUpdate = async () => {
        setConfirmOpen(false,);
        setPhase('updating',);
        setErrorOutput('',);
        try {
            const res = await cms.settings.updateCms();
            if (!res.ok) {
                setPhase('error',);
                setErrorOutput(res.output || 'The update failed. See the server logs for details.',);
                toast.error('Update failed — the server was not restarted.',);
                return;
            }
            toast.success(`Updated ${res.fromVersion ?? '?'} → ${res.toVersion ?? 'latest'} — restarting…`,);
            setPhase('restarting',);
            waitForRestartThenReload();
        } catch (err: any) {
            // A dropped connection AFTER a successful install is expected (the
            // server exits to restart). Treat a network-type failure while we
            // were mid-update as "restarting" and start polling anyway.
            const msg = err?.message || 'Update request failed';
            if (/network|fetch|Failed to fetch|load failed/i.test(msg,)) {
                setPhase('restarting',);
                waitForRestartThenReload();
                return;
            }
            setPhase('error',);
            setErrorOutput(msg,);
            toast.error(msg,);
        }
    };

    const busy = () => phase() === 'updating' || phase() === 'restarting';

    return (
        <div class="settings-card">
            <div class="settings-card__title">CMS Version</div>
            <p class="settings-card__lede">
                Update the CMS to the latest published release. Installing runs
                a package update on the server and <strong>restarts it</strong>,
                so the site will be briefly unavailable ({RESTART_ESTIMATE}) while
                it comes back. New database migrations apply automatically on restart.
            </p>

            <Switch>
                <Match when={info.loading}>
                    <span class="form-help-muted" style={{ margin: 0, }}>Checking version…</span>
                </Match>
                <Match when={info.error}>
                    <span class="form-help-muted" style={{ margin: 0, }}>
                        Couldn't read the version info.
                    </span>
                </Match>
                <Match when={info()}>
                    {(v,) => (
                        <div class="cms-update__versions">
                            <div class="cms-update__row">
                                <span class="cms-update__label">Installed</span>
                                <span class="cms-update__value">{v().current ?? 'unknown'}</span>
                            </div>
                            <div class="cms-update__row">
                                <span class="cms-update__label">Latest</span>
                                <span class="cms-update__value">
                                    <Show when={!v().latestUnavailable} fallback={'unavailable (offline?)'}>
                                        {v().latest ?? 'unknown'}
                                    </Show>
                                </span>
                            </div>
                            <div class="cms-update__row">
                                <span class="cms-update__label">Status</span>
                                <span class="cms-update__value">
                                    <Switch>
                                        <Match when={v().latestUnavailable}>
                                            <span class="cms-update__badge cms-update__badge--muted">
                                                Couldn't check npm
                                            </span>
                                        </Match>
                                        <Match when={v().updateAvailable}>
                                            <span class="cms-update__badge cms-update__badge--available">
                                                ● Update available
                                            </span>
                                        </Match>
                                        <Match when={true}>
                                            <span class="cms-update__badge cms-update__badge--current">
                                                ✓ Up to date
                                            </span>
                                        </Match>
                                    </Switch>
                                </span>
                            </div>
                        </div>
                    )}
                </Match>
            </Switch>

            <div class="u-flex-row u-flex-wrap" style={{ 'margin-top': '0.75rem', }}>
                <button
                    class="btn btn--primary"
                    onClick={() => setConfirmOpen(true,)}
                    disabled={busy() || !info()?.updateAvailable}
                >
                    <Switch fallback={'Update & restart'}>
                        <Match when={phase() === 'updating'}>Installing update…</Match>
                        <Match when={phase() === 'restarting'}>Restarting server…</Match>
                    </Switch>
                </button>
                <button
                    class="btn btn--secondary btn--small"
                    onClick={check}
                    disabled={busy() || checking()}
                >
                    {checking() ? 'Checking…' : 'Check for updates'}
                </button>
            </div>

            <Show when={phase() === 'restarting'}>
                <p class="form-help-muted" style={{ 'margin-top': '0.5rem', }}>
                    The server is restarting — this page will reload automatically
                    when it's back online.
                </p>
            </Show>

            <Show when={phase() === 'error' && errorOutput()}>
                <pre class="cms-update__output">{errorOutput()}</pre>
            </Show>

            <ConfirmModal
                open={confirmOpen()}
                title="Update the CMS?"
                message={`This installs the latest release and restarts the server. The site will be unavailable for ${RESTART_ESTIMATE}. Continue?`}
                confirmLabel="Update & restart"
                cancelLabel="Cancel"
                danger={true}
                onConfirm={() => { void runUpdate(); }}
                onCancel={() => setConfirmOpen(false,)}
            />
        </div>
    );
};

export default CmsUpdatePanel;
