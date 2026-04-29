import { Component, } from 'solid-js';
import { FormField, FormSection, Input, } from '../../../components/ui';
import type { SetStoreFunction, } from 'solid-js/store';
import type { WizardState, } from '../state';
import { pickError, } from '../state';

export interface GeneralSectionProps {
    state: WizardState;
    setState: SetStoreFunction<WizardState>;
    errors: Record<string, string>;
}

export const GeneralSection: Component<GeneralSectionProps> = (props,) => {
    return (
        <FormSection
            title="General"
            description="Basic site identity and upload defaults"
            icon={<span>⚙</span>}
            defaultOpen
            required
        >
            <FormField
                label="Site name"
                required
                error={pickError(props.errors, 'general', 'siteName',)}
            >
                <Input
                    value={props.state.general.siteName}
                    onValueChange={(v,) => props.setState('general', 'siteName', v,)}
                    placeholder="My Site"
                />
            </FormField>

            <FormField
                label="Tagline (optional)"
                hint="A short phrase shown under the site name in the footer. Leave empty to hide it."
                error={pickError(props.errors, 'general', 'siteTagline',)}
            >
                <Input
                    value={props.state.general.siteTagline ?? ''}
                    onValueChange={(v,) => props.setState('general', 'siteTagline', v,)}
                    placeholder="e.g. Independent journalism for the people"
                />
            </FormField>

            <FormField
                label="Upload max size (MB)"
                hint="Maximum size for any single uploaded file"
                error={pickError(props.errors, 'general', 'uploadMaxSizeMb',)}
            >
                <Input
                    type="number"
                    min={1}
                    value={props.state.general.uploadMaxSizeMb}
                    onValueChange={(v,) => props.setState('general', 'uploadMaxSizeMb', Number(v,) || 0,)}
                />
            </FormField>

            <FormField
                label="Upload directory"
                hint="Local path used for stored uploads (when storage is local)"
                error={pickError(props.errors, 'general', 'uploadDir',)}
            >
                <Input
                    value={props.state.general.uploadDir}
                    onValueChange={(v,) => props.setState('general', 'uploadDir', v,)}
                    placeholder="./uploads"
                />
            </FormField>

            <FormField
                label="Data directory"
                hint="Used for derived data such as avatars and thumbnails"
                error={pickError(props.errors, 'general', 'dataDir',)}
            >
                <Input
                    value={props.state.general.dataDir}
                    onValueChange={(v,) => props.setState('general', 'dataDir', v,)}
                    placeholder="./data"
                />
            </FormField>
        </FormSection>
    );
};

export default GeneralSection;
