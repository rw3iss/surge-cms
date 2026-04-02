import { Link, Meta, Title, } from '@solidjs/meta';
import { useParams, } from '@solidjs/router';
import type { Form, } from '@surge/shared';
import { Component, createResource, Show, } from 'solid-js';
import FormRenderer from '../components/FormRenderer';
import { fetchForm, } from '../services/api';
import './Form.scss';

const FormPage: Component = () => {
    const params = useParams();
    const canonicalUrl = () => `${window.location.origin}/forms/${params.slug}`;

    const [form,] = createResource(() => params.slug, async (slug,) => {
        const response = await fetchForm(slug,);
        return response.success ? response.data as Form : null;
    },);

    return (
        <div class="form-page">
            <Show when={form()} fallback={<div class="form-page__loading">Loading...</div>}>
                {(f,) => (
                    <>
                        <Title>{f().title} - Surge Media</Title>
                        <Link rel="canonical" href={canonicalUrl()} />
                        <Meta property="og:title" content={f().title} />
                        <Meta property="og:description" content={f().description || ''} />
                        <Meta property="og:type" content="website" />
                        <Meta property="og:url" content={canonicalUrl()} />
                        <Meta name="twitter:card" content="summary_large_image" />
                        <Meta name="twitter:title" content={f().title} />
                        <Meta name="twitter:description" content={f().description || ''} />

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
