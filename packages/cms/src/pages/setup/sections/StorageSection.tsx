import { Component, Show, createSignal, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { Button, FormField, FormSection, Input, PasswordInput, RadioGroup, Spinner, } from '../../../components/ui';
import { setupApi, } from '../../../services/setup';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface StorageSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
}

export const StorageSection: Component<StorageSectionProps> = (props,) => {
    const [testing, setTesting,] = createSignal(false,);
    const [testResult, setTestResult,] = createSignal<{ ok: boolean; message: string; } | null>(null,);

    const test = async () => {
        const s3 = props.state.storage.s3;
        if (!s3) return;
        setTesting(true,);
        setTestResult(null,);
        const r = await setupApi.testS3(s3,);
        setTesting(false,);
        setTestResult({ ok: r.ok, message: r.ok ? 'Bucket accessible' : (r.error || 'Connection failed'), },);
    };

    return (
        <FormSection
            title="Media storage"
            description="Where uploaded files are kept."
            icon={<span>📦</span>}
            defaultOpen
            required
        >
            <RadioGroup
                name="storage-provider"
                value={props.state.storage.provider}
                onChange={(v,) => props.setState('storage', 'provider', v as 'local' | 's3',)}
                options={[
                    { value: 'local', label: 'Local filesystem', description: 'Stored on disk under the upload directory above.', },
                    { value: 's3', label: 'AWS S3', description: 'Stored in an S3 bucket; optionally served via CloudFront.', },
                ]}
            />

            <Show when={props.state.storage.provider === 's3'}>
                <div style={{ 'margin-top': '20px', }}>
                    <FormField label="AWS region" required error={pickError(props.errors, 'storage', 's3.region',)}>
                        <Input
                            value={props.state.storage.s3?.region ?? ''}
                            onValueChange={(v,) => props.setState('storage', 's3', {
                                region: v,
                                accessKeyId: props.state.storage.s3?.accessKeyId ?? '',
                                secretAccessKey: props.state.storage.s3?.secretAccessKey ?? '',
                                bucket: props.state.storage.s3?.bucket ?? '',
                                cdnUrl: props.state.storage.s3?.cdnUrl,
                            },)}
                            placeholder="us-east-1"
                        />
                    </FormField>
                    <FormField label="Access key ID" required error={pickError(props.errors, 'storage', 's3.accessKeyId',)}>
                        <Input
                            value={props.state.storage.s3?.accessKeyId ?? ''}
                            onValueChange={(v,) => props.setState('storage', 's3', {
                                region: props.state.storage.s3?.region ?? '',
                                accessKeyId: v,
                                secretAccessKey: props.state.storage.s3?.secretAccessKey ?? '',
                                bucket: props.state.storage.s3?.bucket ?? '',
                                cdnUrl: props.state.storage.s3?.cdnUrl,
                            },)}
                        />
                    </FormField>
                    <FormField label="Secret access key" required error={pickError(props.errors, 'storage', 's3.secretAccessKey',)}>
                        <PasswordInput
                            value={props.state.storage.s3?.secretAccessKey ?? ''}
                            onValueChange={(v,) => props.setState('storage', 's3', {
                                region: props.state.storage.s3?.region ?? '',
                                accessKeyId: props.state.storage.s3?.accessKeyId ?? '',
                                secretAccessKey: v,
                                bucket: props.state.storage.s3?.bucket ?? '',
                                cdnUrl: props.state.storage.s3?.cdnUrl,
                            },)}
                        />
                    </FormField>
                    <FormField label="Bucket name" required error={pickError(props.errors, 'storage', 's3.bucket',)}>
                        <Input
                            value={props.state.storage.s3?.bucket ?? ''}
                            onValueChange={(v,) => props.setState('storage', 's3', {
                                region: props.state.storage.s3?.region ?? '',
                                accessKeyId: props.state.storage.s3?.accessKeyId ?? '',
                                secretAccessKey: props.state.storage.s3?.secretAccessKey ?? '',
                                bucket: v,
                                cdnUrl: props.state.storage.s3?.cdnUrl,
                            },)}
                        />
                    </FormField>
                    <FormField label="CDN URL (optional)" hint="If set, public URLs will use this prefix instead of the S3 endpoint.">
                        <Input
                            value={props.state.storage.s3?.cdnUrl ?? ''}
                            onValueChange={(v,) => props.setState('storage', 's3', {
                                region: props.state.storage.s3?.region ?? '',
                                accessKeyId: props.state.storage.s3?.accessKeyId ?? '',
                                secretAccessKey: props.state.storage.s3?.secretAccessKey ?? '',
                                bucket: props.state.storage.s3?.bucket ?? '',
                                cdnUrl: v || undefined,
                            },)}
                            placeholder="https://cdn.example.com"
                        />
                    </FormField>

                    <div class="u-flex-row">
                        <Button variant="secondary" onClick={test} loading={testing()} type="button">
                            Test bucket access
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
                </div>
            </Show>
        </FormSection>
    );
};

export default StorageSection;
