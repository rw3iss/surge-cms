import { Title, } from '@solidjs/meta';
import { useNavigate, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, Show, } from 'solid-js';
import { Alert, Button, Spinner, } from '../../components/ui';
import { setupApi, type InstallationStatus, } from '../../services/setup';
import { AdminUserSection, } from './sections/AdminUserSection';
import { DatabaseSection, } from './sections/DatabaseSection';
import { EmailSection, } from './sections/EmailSection';
import { GeneralSection, } from './sections/GeneralSection';
import { RedisSection, } from './sections/RedisSection';
import { SecuritySection, } from './sections/SecuritySection';
import { StorageSection, } from './sections/StorageSection';
import { buildErrorMap, createWizardStore, } from './state';
import './Setup.scss';

/**
 * Single-page wizard. Sections are independent and read/write a single
 * shared store; the page itself just composes them and owns the
 * submit/poll-restart flow.
 */
const SetupPage: Component = () => {
    const navigate = useNavigate();
    const [state, setState,] = createWizardStore();
    const [errors, setErrors,] = createSignal<Record<string, string>>({},);
    const [globalError, setGlobalError,] = createSignal<string | null>(null,);
    const [installing, setInstalling,] = createSignal(false,);
    const [phase, setPhase,] = createSignal<'editing' | 'restarting'>('editing',);

    const [statusResource, { refetch: refetchStatus, },] = createResource<InstallationStatus | null>(
        () => setupApi.getStatus(),
    );

    // If the app is already installed, kick the user out of the wizard.
    // We send them to /login because (a) /admin redirects unauthenticated
    // users there anyway, and (b) anyone hitting /setup after install is
    // most likely the operator who wants to sign in. The 'restarting'
    // phase suppresses this so the post-install handoff (which has its
    // own redirect to /login) doesn't double-fire.
    createEffect(() => {
        const s = statusResource();
        if (s && !s.needsSetup && phase() === 'editing') {
            navigate('/login', { replace: true, },);
        }
    },);

    // Default admin-user toggle: on only when no admin exists yet.
    createEffect(() => {
        const s = statusResource();
        if (!s) return;
        setState('adminUser', 'enabled', (s.detected.adminCount ?? 0) === 0,);
    },);

    // Pre-fill the database section from detected hint when the user
    // hasn't typed anything yet.
    createEffect(() => {
        const hint = statusResource()?.detected.dbHint;
        if (!hint) return;
        if (hint.host && state.database.host === 'localhost') setState('database', 'host', hint.host,);
        if (hint.port && state.database.port === 5432) setState('database', 'port', hint.port,);
        if (hint.database && state.database.database === 'rw') setState('database', 'database', hint.database,);
        if (hint.user && state.database.user === 'rw') setState('database', 'user', hint.user,);
    },);

    const submit = async () => {
        setErrors({},);
        setGlobalError(null,);
        setInstalling(true,);
        const result = await setupApi.install(state,);
        if (result.ok) {
            setPhase('restarting',);
            setInstalling(false,);
            startPollingForReady();
            return;
        }
        const map = buildErrorMap(result.errors ?? [],);
        setErrors(map,);
        // Always surface the human-readable message in the top alert. Inline
        // errors next to the fields are a bonus, but if the field is hidden
        // (e.g. tab not active), nested under a key the section doesn't
        // explicitly look up, or simply absent from the form, the message
        // would otherwise be silently dropped. The global alert is our
        // guaranteed fallback.
        if (result.message) {
            setGlobalError(result.message,);
        }
        setInstalling(false,);
        // Scroll to top so the alert is visible.
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth', },);
        }
    };

    const startPollingForReady = () => {
        let attempts = 0;
        const tick = async () => {
            attempts++;
            const s = await setupApi.getStatus().catch(() => null,);
            if (s && !s.needsSetup) {
                // Use a hard navigation so the SPA reloads against the
                // running-mode backend (fresh env, fresh routes).
                window.location.href = '/login';
                return;
            }
            if (attempts < 60) {
                setTimeout(tick, 1500,);
            } else {
                setGlobalError('The server hasn\'t come back online. Please check the backend logs and refresh.',);
                setPhase('editing',);
            }
        };
        setTimeout(tick, 2000,);
    };

    return (
        <div class="setup-page">
            <Title>Setup</Title>
            <div class="setup-page__container">
                <div class="setup-page__header">
                    <h1>Welcome — let's get you set up</h1>
                    <p>
                        This is a one-time wizard. We'll detect what's already in place,
                        ask for what's missing, and get the app running in a few minutes.
                    </p>
                </div>

                <Show when={statusResource.loading}>
                    <div style={{ 'text-align': 'center', padding: '40px 0', }}>
                        <Spinner size={28} label="Checking installation status..." />
                    </div>
                </Show>

                <Show when={statusResource()}>
                    {(status) => (
                        <>
                            <div class="setup-page__welcome-card">
                                <span class="setup-page__welcome-card__icon">i</span>
                                <div class="setup-page__welcome-card__body">
                                    <h3>What we found</h3>
                                    <p>
                                        Stage: <strong>{status().stage}</strong>
                                        {status().blockers.length > 0 && ` — ${status().blockers.length} thing(s) to address`}
                                    </p>
                                    <div class="setup-page__welcome-card__detected">
                                        <span class={`setup-page__welcome-card__pill setup-page__welcome-card__pill--${status().detected.dbReachable ? 'ok' : 'missing'}`}>
                                            {status().detected.dbReachable ? '✓' : '○'} Database
                                        </span>
                                        <span class={`setup-page__welcome-card__pill setup-page__welcome-card__pill--${status().detected.redisReachable ? 'ok' : 'missing'}`}>
                                            {status().detected.redisReachable ? '✓' : '○'} Redis
                                        </span>
                                        <span class={`setup-page__welcome-card__pill setup-page__welcome-card__pill--${status().detected.hasJwtSecret ? 'ok' : 'missing'}`}>
                                            {status().detected.hasJwtSecret ? '✓' : '○'} JWT secret
                                        </span>
                                        <Show when={status().detected.adminCount !== undefined}>
                                            <span class={`setup-page__welcome-card__pill setup-page__welcome-card__pill--${(status().detected.adminCount ?? 0) > 0 ? 'ok' : 'missing'}`}>
                                                {(status().detected.adminCount ?? 0) > 0 ? '✓' : '○'} Admin user
                                            </span>
                                        </Show>
                                    </div>
                                </div>
                            </div>

                            <Show when={globalError()}>
                                <Alert tone="error" title="Installation error">
                                    {globalError()}
                                </Alert>
                            </Show>

                            <GeneralSection state={state} setState={setState} errors={errors()} />
                            <DatabaseSection
                                state={state}
                                setState={setState}
                                errors={errors()}
                                detected={status().detected.dbReachable}
                                detectedHint={status().detected.dbHint}
                            />
                            <AdminUserSection
                                state={state}
                                setState={setState}
                                errors={errors()}
                                adminExists={(status().detected.adminCount ?? 0) > 0}
                            />
                            <RedisSection
                                state={state}
                                setState={setState}
                                errors={errors()}
                                detected={status().detected.redisReachable}
                            />
                            <StorageSection state={state} setState={setState} errors={errors()} />
                            <SecuritySection state={state} setState={setState} errors={errors()} />
                            <EmailSection state={state} setState={setState} errors={errors()} />

                            <div class="setup-page__footer">
                                <span class="setup-page__footer__hint">
                                    Required sections: General, Database, Storage, Security
                                </span>
                                <div class="u-flex-row">
                                    <Button variant="ghost" type="button" onClick={() => refetchStatus()}>
                                        Re-detect
                                    </Button>
                                    <Button variant="primary" onClick={submit} loading={installing()} type="button">
                                        Install
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </Show>

                <Show when={phase() === 'restarting'}>
                    <div class="setup-page__overlay" role="status" aria-live="polite">
                        <Spinner size={32} />
                        <h2>Setting up your installation…</h2>
                        <p>
                            The backend is restarting with your new configuration. This usually
                            takes a few seconds. You'll be redirected to the admin login when
                            it's ready.
                        </p>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default SetupPage;
