import { Component, Show, } from 'solid-js';
import { getForms, } from '@/services/adminData';
import EntitySearchSelect from '../../common/EntitySearchSelect';

interface FormBlockProps {
    data: Record<string, any>;
    mode: string;
    onUpdate: (data: Record<string, any>,) => void;
}

const FormBlock: Component<FormBlockProps> = (props,) => {
    return (
        <div class="block-form">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-reference__preview">
                        <Show
                            when={props.data.formId}
                            fallback={
                                <span class="block-text__empty">
                                    No form selected. Click Edit to choose one.
                                </span>
                            }
                        >
                            <span>
                                Form: <strong>{props.data.title || props.data.formId}</strong>
                            </span>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <EntitySearchSelect
                        label="Form"
                        placeholder="Search forms by name..."
                        selectedTitle={props.data.title}
                        selectedId={props.data.formId}
                        fetchItems={async () => {
                            const forms = await getForms();
                            return forms.filter((f: any,) => f.isActive !== false);
                        }}
                        onSelect={(form,) => {
                            props.onUpdate({
                                ...props.data,
                                formId: form.id,
                                title: form.title,
                                slug: form.slug,
                            },);
                        }}
                        emptyMessage="No forms found"
                    />
                </div>
            </Show>
        </div>
    );
};

export default FormBlock;
