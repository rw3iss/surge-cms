import { Component, Show, createSignal, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { Alert, Button, Checkbox, FormField, FormSection, Input, PasswordInput, Spinner, Tabs, } from '../../../components/ui';
import { setupApi, type PostgresProbeResult, } from '../../../services/setup';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface DatabaseSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
    detected: boolean;
    detectedHint?: { host?: string; port?: number; database?: string; user?: string; };
}

/**
 * The probe result drives both the inline status next to the button and
 * the helpful hint below. We translate the classified `kind` into
 * concrete next-step copy and, where possible, into a default toggle
 * state (e.g. role-missing → check "Create role if missing").
 */
function describeProbe(state: WizardState, r: PostgresProbeResult,): {
    tone: 'ok' | 'warn' | 'error';
    message: string;
    suggestion?: string;
} {
    if (r.ok) {
        return { tone: 'ok', message: 'Connected successfully', };
    }
    const dbName = state.database.database || 'the database';
    const userName = state.database.user || 'the user';
    switch (r.kind) {
        case 'unreachable':
            return {
                tone: 'error',
                message: `Cannot reach Postgres at ${state.database.host}:${state.database.port}`,
                suggestion: 'Make sure Postgres is running and that the host and port are correct.',
            };
        case 'timeout':
            return {
                tone: 'error',
                message: 'Connection timed out',
                suggestion: 'The Postgres server is not responding. Check firewall or network rules.',
            };
        case 'database-missing':
            return {
                tone: 'warn',
                message: `Postgres detected. Database "${dbName}" does not exist yet.`,
                suggestion: 'Toggle "Create database if it doesn\'t exist" below and provide superuser credentials, then run Install.',
            };
        case 'role-missing':
            return {
                tone: 'warn',
                message: `Postgres detected. Role "${userName}" does not exist yet.`,
                suggestion: 'Toggle "Create role if it doesn\'t exist" below and provide superuser credentials, then run Install.',
            };
        case 'auth-failed':
            return {
                tone: 'warn',
                message: `Postgres detected, but the password for "${userName}" was rejected.`,
                suggestion:
                    'If the user already exists, fix the password. If not, toggle "Create role if it doesn\'t exist" and provide superuser credentials so the wizard can create it.',
            };
        default:
            return { tone: 'error', message: r.error || 'Connection failed', };
    }
}

export const DatabaseSection: Component<DatabaseSectionProps> = (props,) => {
    const [testing, setTesting,] = createSignal(false,);
    const [probe, setProbe,] = createSignal<PostgresProbeResult | null>(null,);

    const test = async () => {
        setTesting(true,);
        setProbe(null,);
        const r = await setupApi.testDb({
            host: props.state.database.host,
            port: props.state.database.port,
            database: props.state.database.database,
            user: props.state.database.user,
            password: props.state.database.password,
        },);
        setTesting(false,);
        setProbe(r,);

        // Convenience: when the probe tells us exactly what's missing,
        // pre-flip the corresponding toggle so the user can just provide
        // superuser creds and click Install.
        if (!r.ok && r.kind === 'database-missing') {
            props.setState('database', 'createDatabase', true,);
        }
        if (!r.ok && (r.kind === 'role-missing' || r.kind === 'auth-failed')) {
            props.setState('database', 'createRole', true,);
        }
    };

    const status = props.detected ? { tone: 'ok' as const, label: '✓ Detected', } : undefined;

    const provisionRequested = () =>
        props.state.database.mode === 'create'
        || Boolean(props.state.database.createRole,)
        || Boolean(props.state.database.createDatabase,);

    const updateSu = (patch: Partial<NonNullable<WizardState['database']['superuser']>>,) => {
        const current = props.state.database.superuser ?? { user: 'postgres', password: '', };
        props.setState('database', 'superuser', { ...current, ...patch, },);
    };

    const probeDescription = () => {
        const p = probe();
        return p ? describeProbe(props.state, p,) : null;
    };

    return (
        <FormSection
            title="Database"
            description="PostgreSQL connection. Either point at an existing database or create one in place."
            icon={<span>🗄</span>}
            status={status}
            defaultOpen
            required
        >
            <Show when={props.detected && props.detectedHint}>
                <div style={{ 'margin-bottom': '16px', }}>
                    <Alert tone="success" title="Database is reachable">
                        Found connection at{' '}
                        <code>{props.detectedHint!.host}:{props.detectedHint!.port}/{props.detectedHint!.database}</code>{' '}
                        using user <code>{props.detectedHint!.user}</code>.
                    </Alert>
                </div>
            </Show>

            <div style={{ 'margin-bottom': '16px', }}>
                <Tabs
                    items={[
                        { value: 'existing', label: 'Connect to existing', },
                        { value: 'create', label: 'Create new database', },
                    ]}
                    value={props.state.database.mode}
                    onChange={(v,) => {
                        const mode = v as 'existing' | 'create';
                        props.setState('database', 'mode', mode,);
                        // 'create' is shorthand for both flags. Switching back
                        // to 'existing' clears them so the toggles below start
                        // unchecked.
                        if (mode === 'create') {
                            props.setState('database', 'createRole', true,);
                            props.setState('database', 'createDatabase', true,);
                        } else {
                            props.setState('database', 'createRole', false,);
                            props.setState('database', 'createDatabase', false,);
                        }
                    }}
                />
            </div>

            <FormField label="Host" error={pickError(props.errors, 'database', 'host',)}>
                <Input
                    value={props.state.database.host ?? ''}
                    onValueChange={(v,) => props.setState('database', 'host', v,)}
                    placeholder="localhost"
                />
            </FormField>

            <FormField label="Port" error={pickError(props.errors, 'database', 'port',)}>
                <Input
                    type="number"
                    value={props.state.database.port ?? 5432}
                    onValueChange={(v,) => props.setState('database', 'port', Number(v,) || 5432,)}
                />
            </FormField>

            <FormField label="Database name" error={pickError(props.errors, 'database', 'database',)}>
                <Input
                    value={props.state.database.database ?? ''}
                    onValueChange={(v,) => props.setState('database', 'database', v,)}
                    placeholder="rw"
                />
            </FormField>

            <FormField label="User" error={pickError(props.errors, 'database', 'user',)}>
                <Input
                    value={props.state.database.user ?? ''}
                    onValueChange={(v,) => props.setState('database', 'user', v,)}
                    placeholder="rw"
                />
            </FormField>

            <FormField label="Password" error={pickError(props.errors, 'database', 'password',)}>
                <PasswordInput
                    value={props.state.database.password ?? ''}
                    onValueChange={(v,) => props.setState('database', 'password', v,)}
                />
            </FormField>

            <Show when={props.state.database.mode === 'existing'}>
                <div class="setup-db-toggles">
                    <Checkbox
                        checked={Boolean(props.state.database.createRole,)}
                        onChange={(v,) => props.setState('database', 'createRole', v,)}
                        label={
                            <span>
                                <strong>Create role if it doesn't exist</strong>
                                <br />
                                <span style={{ 'font-size': '12px', color: '#6b7280', }}>
                                    Uses superuser credentials to <code>CREATE ROLE</code> with the password above and grant access to the database.
                                </span>
                            </span>
                        }
                    />
                    <Checkbox
                        checked={Boolean(props.state.database.createDatabase,)}
                        onChange={(v,) => props.setState('database', 'createDatabase', v,)}
                        label={
                            <span>
                                <strong>Create database if it doesn't exist</strong>
                                <br />
                                <span style={{ 'font-size': '12px', color: '#6b7280', }}>
                                    Uses superuser credentials to <code>CREATE DATABASE</code> owned by the user above.
                                </span>
                            </span>
                        }
                    />
                </div>
            </Show>

            <Show when={provisionRequested()}>
                <h4 style={{ 'margin-top': '24px', 'margin-bottom': '8px', }}>Superuser credentials</h4>
                <p style={{ 'font-size': '13px', color: '#6b7280', 'margin-bottom': '16px', }}>
                    Used only during install to <code>CREATE ROLE</code>/<code>CREATE DATABASE</code>. Not stored.
                </p>
                <FormField label="Superuser" error={pickError(props.errors, 'database', 'superuser.user',)}>
                    <Input
                        value={props.state.database.superuser?.user ?? 'postgres'}
                        onValueChange={(v,) => updateSu({ user: v, },)}
                        placeholder="postgres"
                    />
                </FormField>
                <FormField label="Superuser password" error={pickError(props.errors, 'database', 'superuser.password',)}>
                    <PasswordInput
                        value={props.state.database.superuser?.password ?? ''}
                        onValueChange={(v,) => updateSu({ password: v, },)}
                    />
                </FormField>
            </Show>

            <div style={{ display: 'flex', gap: '12px', 'align-items': 'center', 'margin-top': '8px', }}>
                <Button variant="secondary" onClick={test} loading={testing()} type="button">
                    Test connection
                </Button>
                <Show when={testing()}>
                    <Spinner label="Testing..." />
                </Show>
                <Show when={!testing() ? probe() : null}>
                    {(p) => {
                        const d = describeProbe(props.state, p(),);
                        const colors: Record<typeof d.tone, string> = {
                            ok: 'var(--success, #10b981)',
                            warn: 'var(--warning, #d97706)',
                            error: 'var(--error, #ef4444)',
                        };
                        const icons: Record<typeof d.tone, string> = { ok: '✓', warn: '!', error: '✗', };
                        return (
                            <span style={{ color: colors[d.tone], 'font-size': '14px', }}>
                                {icons[d.tone]} {d.message}
                            </span>
                        );
                    }}
                </Show>
            </div>

            <Show when={probeDescription()?.suggestion}>
                <div style={{ 'margin-top': '12px', }}>
                    <Alert
                        tone={
                            probeDescription()!.tone === 'ok'
                                ? 'success'
                                : probeDescription()!.tone === 'warn'
                                ? 'warning'
                                : 'error'
                        }
                    >
                        {probeDescription()!.suggestion}
                    </Alert>
                </div>
            </Show>
        </FormSection>
    );
};

export default DatabaseSection;
