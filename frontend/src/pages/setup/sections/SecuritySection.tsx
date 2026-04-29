import { Component, createEffect, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { Button, FormField, FormSection, Input, } from '../../../components/ui';
import { setupApi, } from '../../../services/setup';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface SecuritySectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
}

export const SecuritySection: Component<SecuritySectionProps> = (props,) => {
    // Auto-generate a secret on first mount if empty so users see a sensible default.
    createEffect(() => {
        if (!props.state.security.jwtSecret) {
            void setupApi.generateJwt().then((s,) => props.setState('security', 'jwtSecret', s,),).catch(() => {/* ignore */},);
        }
    },);

    const regenerate = async () => {
        const s = await setupApi.generateJwt();
        props.setState('security', 'jwtSecret', s,);
    };

    return (
        <FormSection
            title="Security"
            description="JWT signing secret and token lifetimes."
            icon={<span>🔐</span>}
            defaultOpen
            required
        >
            <FormField
                label="JWT secret"
                required
                hint="Used to sign access and refresh tokens. Keep this secret. Minimum 32 characters."
                error={pickError(props.errors, 'security', 'jwtSecret',)}
            >
                <Input
                    value={props.state.security.jwtSecret}
                    onValueChange={(v,) => props.setState('security', 'jwtSecret', v,)}
                    suffix={
                        <button type="button" class="ui-input__regen" onClick={regenerate} aria-label="Regenerate">
                            ↻
                        </button>
                    }
                />
            </FormField>

            <FormField
                label="Access token lifetime"
                hint="Format: '15m', '1h'. Default 15m."
                error={pickError(props.errors, 'security', 'accessTokenExpires',)}
            >
                <Input
                    value={props.state.security.accessTokenExpires ?? '15m'}
                    onValueChange={(v,) => props.setState('security', 'accessTokenExpires', v,)}
                />
            </FormField>

            <FormField
                label="Refresh token lifetime"
                hint="Format: '7d', '30d'. Default 7d."
                error={pickError(props.errors, 'security', 'refreshTokenExpires',)}
            >
                <Input
                    value={props.state.security.refreshTokenExpires ?? '7d'}
                    onValueChange={(v,) => props.setState('security', 'refreshTokenExpires', v,)}
                />
            </FormField>
        </FormSection>
    );
};

export default SecuritySection;
