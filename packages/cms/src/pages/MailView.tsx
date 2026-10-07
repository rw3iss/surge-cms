/**
 * `/mail/:jobId` — a sent mailing-list email as a web page (the target of
 * `{{mail.viewUrl}}` / `{{mail.url}}` / `{{view_in_browser_url}}`).
 *
 * Inside the site shell (header/footer), the email centred in a sandboxed frame.
 * Personalisation is decided by the server: the signed `?r=` token from the
 * email link → that recipient; else the signed-in user; else nobody (and only
 * for a list with a public archive — otherwise this reads "not available").
 */
import { Meta, Title, } from '@solidjs/meta';
import { A, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import EmailFrame from '../components/mail/EmailFrame';
import { cms, } from '../services/cmsClient';
import { formatPageTitle, } from '../stores/siteSettings';
import './MailView.scss';

const MailView: Component = () => {
    const params = useParams<{ jobId: string; }>();
    const [search,] = useSearchParams<{ r?: string; }>();
    const [mail,] = createResource(
        () => ({ id: params.jobId, r: search.r, }),
        async (k,) => {
            try {
                return await cms.mailArchive.view(k.id, k.r,);
            } catch {
                return null;
            }
        },
    );

    return (
        <div class="mail-view page-wrapper">
            <Title>{formatPageTitle(mail()?.subject || 'Email',)}</Title>
            {/* A personalised copy (signed ?r= link) must never be indexed. */}
            <Show when={search.r}>
                <Meta name="robots" content="noindex, nofollow" />
            </Show>
            <Show when={!mail.loading} fallback={<p class="mail-view__note">Loading…</p>}>
                <Show
                    when={mail()}
                    fallback={
                        <div class="mail-view__missing">
                            <h1>Email not available</h1>
                            <p>This email doesn't exist, or it isn't public. If it was sent to you, open it from the link in the email.</p>
                            <p><A href="/mail">Browse the email archive</A></p>
                        </div>
                    }
                >
                    <header class="mail-view__head">
                        <A href="/mail" class="mail-view__back">← Email archive</A>
                        <h1>{mail()!.subject}</h1>
                        <p class="mail-view__meta">
                            {mail()!.listName}
                            <Show when={mail()!.sentAt}> · {new Date(mail()!.sentAt!,).toLocaleDateString(undefined, { dateStyle: 'long', },)}</Show>
                        </p>
                    </header>
                    <div class="mail-view__frame">
                        <EmailFrame html={mail()!.html} title={mail()!.subject} />
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default MailView;
