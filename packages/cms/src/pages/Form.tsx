import { useParams, } from '@solidjs/router';
import type { Form, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import FormRenderer from '../components/forms/FormRenderer';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import './Form.scss';

const FormPage: Component = () => {
    const params = useParams();
    const canonicalUrl = () => `${window.location.origin}/forms/${params.slug}`;

    const [form,] = createResource(() => params.slug, async (slug,) => {
        try {
            return await cms.forms.getBySlug(slug,) as Form;
        } catch {
            return null;
        }
    },);

    return (
        <div class="form-page">
            <Show when={form()} fallback={<div class="form-page__loading">Loading...</div>}>
                {(f,) => (
                    <>
                        <SeoHead
                            title={f().title}
                            description={f().description || ''}
                            canonical={canonicalUrl()}
                            noindex={true}
                        />

                        <div class="page-header">
                            <h1>{f().title}</h1>
                            <Show when={f().description}>
                                <p>{f().description}</p>
                            </Show>
                        </div>

                        <FormRenderer form={f()} />
                    </>
                )}
            </Show>
        </div>
    );
};

export default FormPage;
