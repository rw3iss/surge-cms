import { Component, Show, createSignal, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { Button, Checkbox, FormField, FormSection, Input, PasswordInput, Spinner, } from '../../../components/ui';
import { setupApi, } from '../../../services/setup';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface EmailSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
}

export const EmailSection: Component<EmailSectionProps> = (props,) => {
    const [testing, setTesting,] = createSignal(false,);
    const [testResult, setTestResult,] = createSignal<{ ok: boolean; message: string; } | null>(null,);

    const test = async () => {
        if (!props.state.email.host || !props.state.email.port) return;
        setTesting(true,);
        setTestResult(null,);
        const r = await setupApi.testSmtp({
            host: props.state.email.host,
            port: props.state.email.port,
            secure: props.state.email.secure,
            user: props.state.email.user,
            pass: props.state.email.pass,
        },);
        setTesting(false,);
        setTestResult({ ok: r.ok, message: r.ok ? 'SMTP verified' : (r.error || 'SMTP test failed'), },);
    };

    return (
        <FormSection
            title="Email (SMTP)"
            description="Optional. Used for transactional emails (welcome, donation receipts)."
            icon={<span>✉</span>}
            toggleable
            enabled={props.state.email.enabled}
            onEnabledChange={(v,) => props.setState('email', 'enabled', v,)}
            defaultOpen={false}
        >
            <FormField label="SMTP host" required error={pickError(props.errors, 'email', 'host',)}>
                <Input
                    value={props.state.email.host ?? ''}
                    onValueChange={(v,) => props.setState('email', 'host', v,)}
                    placeholder="smtp.example.com"
                />
            </FormField>
            <FormField label="Port" required error={pickError(props.errors, 'email', 'port',)}>
                <Input
                    type="number"
                    value={props.state.email.port ?? 587}
                    onValueChange={(v,) => props.setState('email', 'port', Number(v,) || 587,)}
                />
            </FormField>
            <FormField label="Use TLS" hint="On for port 465; usually off for 587 (STARTTLS).">
                <Checkbox
                    checked={Boolean(props.state.email.secure,)}
                    onChange={(v,) => props.setState('email', 'secure', v,)}
                    label={<span>Encrypted connection</span>}
                />
            </FormField>
            <FormField label="Username" error={pickError(props.errors, 'email', 'user',)}>
                <Input
                    value={props.state.email.user ?? ''}
                    onValueChange={(v,) => props.setState('email', 'user', v,)}
                />
            </FormField>
            <FormField label="Password" error={pickError(props.errors, 'email', 'pass',)}>
                <PasswordInput
                    value={props.state.email.pass ?? ''}
                    onValueChange={(v,) => props.setState('email', 'pass', v,)}
                />
            </FormField>
            <FormField label='"From" address' required error={pickError(props.errors, 'email', 'from',)}>
                <Input
                    value={props.state.email.from ?? ''}
                    onValueChange={(v,) => props.setState('email', 'from', v,)}
                    placeholder='My Site <noreply@example.com>'
                />
            </FormField>

            <div class="u-flex-row">
                <Button variant="secondary" onClick={test} loading={testing()} type="button">
                    Send test verify
                </Button>
                <Show when={testing()}>
                    <Spinner label="Verifying..." />
                </Show>
                <Show when={testResult()}>
                    <span style={{ color: testResult()!.ok ? 'var(--success, #10b981)' : 'var(--error, #ef4444)', 'font-size': '14px', }}>
                        {testResult()!.ok ? '✓' : '✗'} {testResult()!.message}
                    </span>
                </Show>
            </div>
        </FormSection>
    );
};

export default EmailSection;
