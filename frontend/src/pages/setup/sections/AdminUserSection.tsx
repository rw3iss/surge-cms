import { Component, } from 'solid-js';
import type { SetStoreFunction, } from 'solid-js/store';
import { FormField, FormSection, Input, PasswordInput, } from '../../../components/ui';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface AdminUserSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
    /** When true, an admin already exists in the detected DB; we hint that. */
    adminExists: boolean;
}

export const AdminUserSection: Component<AdminUserSectionProps> = (props,) => {
    return (
        <FormSection
            title="Admin user"
            description={
                props.adminExists
                    ? 'An admin already exists. Toggle on to add another.'
                    : 'Create the first admin login. You can also leave this off and add one later via CLI.'
            }
            icon={<span>👤</span>}
            toggleable
            enabled={props.state.adminUser.enabled}
            onEnabledChange={(v,) => props.setState('adminUser', 'enabled', v,)}
            defaultOpen={!props.adminExists}
        >
            <FormField
                label="Email"
                required
                error={pickError(props.errors, 'admin-user', 'email',)}
            >
                <Input
                    type="email"
                    autocomplete="off"
                    value={props.state.adminUser.email ?? ''}
                    onValueChange={(v,) => props.setState('adminUser', 'email', v,)}
                    placeholder="admin@example.com"
                />
            </FormField>

            <FormField
                label="Display name"
                error={pickError(props.errors, 'admin-user', 'displayName',)}
            >
                <Input
                    value={props.state.adminUser.displayName ?? ''}
                    onValueChange={(v,) => props.setState('adminUser', 'displayName', v,)}
                    placeholder="Admin"
                />
            </FormField>

            <FormField
                label="Password"
                required
                hint="At least 8 characters."
                error={pickError(props.errors, 'admin-user', 'password',)}
            >
                <PasswordInput
                    autocomplete="new-password"
                    value={props.state.adminUser.password ?? ''}
                    onValueChange={(v,) => props.setState('adminUser', 'password', v,)}
                />
            </FormField>

            <FormField
                label="Confirm password"
                required
                error={pickError(props.errors, 'admin-user', 'confirmPassword',)}
            >
                <PasswordInput
                    autocomplete="new-password"
                    value={props.state.adminUser.confirmPassword ?? ''}
                    onValueChange={(v,) => props.setState('adminUser', 'confirmPassword', v,)}
                />
            </FormField>
        </FormSection>
    );
};

export default AdminUserSection;
