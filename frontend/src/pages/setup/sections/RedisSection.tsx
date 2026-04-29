import { Component, Show, createSignal, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { Button, FormField, FormSection, Input, Spinner, } from '../../../components/ui';
import { setupApi, } from '../../../services/setup';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface RedisSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
    detected: boolean;
}

export const RedisSection: Component<RedisSectionProps> = (props,) => {
    const [testing, setTesting,] = createSignal(false,);
    const [testResult, setTestResult,] = createSignal<{ ok: boolean; message: string; } | null>(null,);

    const test = async () => {
        if (!props.state.redis.url) return;
        setTesting(true,);
        setTestResult(null,);
        const r = await setupApi.testRedis(props.state.redis.url,);
        setTesting(false,);
        setTestResult({ ok: r.ok, message: r.ok ? 'Connection successful' : (r.error || 'Connection failed'), },);
    };

    return (
        <FormSection
            title="Redis cache"
            description="Optional. Recommended for production; site works without it but won't cache reads."
            icon={<span>⚡</span>}
            toggleable
            enabled={props.state.redis.enabled}
            onEnabledChange={(v,) => props.setState('redis', 'enabled', v,)}
            status={props.detected ? { tone: 'ok', label: '✓ Detected', } : undefined}
            defaultOpen={false}
        >
            <FormField
                label="Redis URL"
                required
                hint="Default: redis://localhost:6379"
                error={pickError(props.errors, 'redis', 'url',)}
            >
                <Input
                    value={props.state.redis.url ?? ''}
                    onValueChange={(v,) => props.setState('redis', 'url', v,)}
                    placeholder="redis://localhost:6379"
                />
            </FormField>

            <FormField
                label="Cache TTL (seconds)"
                hint="How long cached responses are kept by default."
                error={pickError(props.errors, 'redis', 'cacheTtlSeconds',)}
            >
                <Input
                    type="number"
                    value={props.state.redis.cacheTtlSeconds ?? 300}
                    onValueChange={(v,) => props.setState('redis', 'cacheTtlSeconds', Number(v,) || 300,)}
                />
            </FormField>

            <div style={{ display: 'flex', gap: '12px', 'align-items': 'center', }}>
                <Button variant="secondary" onClick={test} loading={testing()} type="button">
                    Test connection
                </Button>
                <Show when={testing()}>
                    <Spinner label="Testing..." />
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

export default RedisSection;
