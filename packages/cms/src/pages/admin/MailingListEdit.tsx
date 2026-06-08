/**
 * Mailing list create/edit page. Top section: list settings form
 * (name/slug/description/flags). Bottom section: paginated subscriber
 * table with search + bulk-delete + manual-add modal.
 *
 * Templates dropdown for `default_template_id` is stubbed for Phase 3.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import {
    Component, createResource, createSignal, For, onMount, Show,
} from 'solid-js';
import type { MailingList, MailingListSubscriber, } from '@rw/cms-shared';
import { FormField, FormSection, } from '../../components/admin/forms';
import Toggle from '../../components/admin/common/Toggle';
import SubscriberFormModal from '../../components/admin/mailing-lists/SubscriberFormModal';
import { cms, } from '../../services/cmsClient';

interface SubscriberListResponse { items: MailingListSubscriber[]; total: number; }

const MailingListEdit: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const isNew = () => params.id === 'new';

    const [name, setName,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [isEnabled, setIsEnabled,] = createSignal(true,);
    const [registeredUsersOnly, setRegisteredUsersOnly,] = createSignal(false,);
    const [doubleOptIn, setDoubleOptIn,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const [search, setSearch,] = createSignal('',);
    const [selectedIds, setSelectedIds,] = createSignal(new Set<string>(),);
    const [showAdd, setShowAdd,] = createSignal(false,);
    const [editingSub, setEditingSub,] = createSignal<MailingListSubscriber | null>(null,);

    /** Fetch the list and apply its fields to local signals. Used on
     *  mount and after save so the header (and form) always show the
     *  server-of-record state. */
    const refreshList = async (): Promise<void> => {
        if (isNew()) return;
        try {
            const l = await cms.mailingLists.getById(params.id,) as MailingList;
            setName(l.name,);
            setSlug(l.slug,);
            setDescription(l.description ?? '',);
            setIsEnabled(l.isEnabled,);
            setRegisteredUsersOnly(l.registeredUsersOnly,);
            setDoubleOptIn(l.doubleOptIn,);
        } catch {
            /* error toasted by the bus */
        }
    };

    onMount(() => { void refreshList(); },);

    const slugify = (s: string,): string =>
        s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-',).replace(/^-+|-+$/g, '',).slice(0, 64,);

    const handleSave = async (): Promise<void> => {
        setSaving(true,);
        setError(null,);
        try {
            const data = {
                slug: slug() || slugify(name(),),
                name: name(),
                description: description() || undefined,
                isEnabled: isEnabled(),
                registeredUsersOnly: registeredUsersOnly(),
                doubleOptIn: doubleOptIn(),
            };
            if (isNew()) {
                const created = await cms.mailingLists.create(data as any,);
                navigate(`/admin/mailing-lists/${(created as MailingList).id}`,);
            } else {
                await cms.mailingLists.update(params.id, data as any,);
                // Reload so the header + form reflect any server-side
                // normalization (slug lowercase, etc.).
                await refreshList();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed.',);
        } finally { setSaving(false,); }
    };

    const handleDelete = async (): Promise<void> => {
        if (!confirm('Delete this list and all its subscribers? This cannot be undone.',)) return;
        await cms.mailingLists.remove(params.id,);
        navigate('/admin/mailing-lists',);
    };

    // ─── Subscribers ───────────────────────────────────────────────

    const [subscribers, { refetch: refetchSubs, },] = createResource(
        () => isNew() ? null : { id: params.id, search: search(), },
        async (args,) => {
            if (!args) return null;
            try {
                return await cms.mailingLists.subscribers(args.id, { search: args.search, limit: 100, },) as SubscriberListResponse;
            } catch {
                return { items: [], total: 0, };
            }
        },
    );

    const toggleSelect = (id: string,): void => {
        const next = new Set(selectedIds(),);
        if (next.has(id,)) next.delete(id,); else next.add(id,);
        setSelectedIds(next,);
    };

    const bulkDelete = async (): Promise<void> => {
        const ids = Array.from(selectedIds(),);
        if (ids.length === 0) return;
        if (!confirm(`Remove ${ids.length} subscriber(s) from the list?`,)) return;
        await cms.mailingLists.bulkDeleteSubscribers(params.id, { ids, },);
        setSelectedIds(new Set<string>(),);
        refetchSubs();
    };

    return (
        <div class="mailing-list-edit-page">
            <Title>{isNew() ? 'New List' : name() || 'Edit List'} - Admin</Title>

            <div class="admin-header">
                <A href="/admin/mailing-lists" class="admin-header__back">← Lists</A>
                <h1>{isNew() ? 'New Mailing List' : name() || '…'}</h1>
                <div class="admin-header__actions">
                    <Show when={!isNew()}>
                        <A href={`/admin/mail/send?list=${params.id}`} class="btn btn--secondary">Send to this list</A>
                        <button type="button" class="btn btn--danger" onClick={handleDelete}>Delete</button>
                    </Show>
                    <button type="button" class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <section class="admin-section list-settings">
                <header class="admin-section__header"><h2>Settings</h2></header>

                <div class="list-settings__grid">
                    <FormSection title="Identity">
                        <div class="list-settings__row">
                            <FormField label="Name" class="list-settings__field--grow">
                                <input
                                    type="text"
                                    value={name()}
                                    onInput={(e,) => {
                                        setName(e.currentTarget.value,);
                                        if (isNew() && !slug()) setSlug(slugify(e.currentTarget.value,),);
                                    }}
                                />
                            </FormField>
                            <FormField
                                label="Slug"
                                hint={`Public subscribe URL: /lists/${slug() || '<slug>'}/subscribe`}
                                class="list-settings__field--grow"
                            >
                                <input
                                    type="text"
                                    value={slug()}
                                    onInput={(e,) => setSlug(slugify(e.currentTarget.value,),)}
                                    placeholder="newsletter"
                                />
                            </FormField>
                        </div>
                        <FormField label="Description">
                            <textarea
                                rows={2}
                                value={description()}
                                onInput={(e,) => setDescription(e.currentTarget.value,)}
                            />
                        </FormField>
                    </FormSection>

                    <FormSection title="Subscription policy">
                        <div class="policy-rows">
                            <PolicyRow
                                checked={isEnabled()}
                                onChange={setIsEnabled}
                                label="Enabled"
                            />
                            <PolicyRow
                                checked={registeredUsersOnly()}
                                onChange={setRegisteredUsersOnly}
                                label="Registered users only"
                                hint="Public subscribe requires a logged-in user."
                            />
                            <PolicyRow
                                checked={doubleOptIn()}
                                onChange={setDoubleOptIn}
                                label="Double opt-in"
                                hint="Subscribers must click a confirmation link before receiving mail."
                            />
                        </div>
                    </FormSection>
                </div>
            </section>

            <Show when={!isNew()}>
                <section class="admin-section admin-section--wide">
                    <header class="admin-section__header">
                        <h2>Subscribers ({subscribers()?.total ?? 0})</h2>
                        <div class="admin-section__actions">
                            <input
                                type="search"
                                placeholder="Search name or email…"
                                value={search()}
                                onInput={(e,) => setSearch(e.currentTarget.value,)}
                            />
                            <Show when={selectedIds().size > 0}>
                                <button type="button" class="btn btn--small btn--danger" onClick={bulkDelete}>
                                    Remove {selectedIds().size}
                                </button>
                            </Show>
                            <button type="button" class="btn btn--small btn--primary" onClick={() => setShowAdd(true,)}>
                                + Add Subscriber
                            </button>
                        </div>
                    </header>

                    <Show when={!subscribers.loading} fallback={<p>Loading…</p>}>
                        <Show
                            when={(subscribers()?.items ?? []).length > 0}
                            fallback={<div class="empty-state"><em>No subscribers match.</em></div>}
                        >
                            <div class="admin-table-container">
                                <table class="admin-table">
                                    <thead>
                                        <tr>
                                            <th />
                                            <th>Email</th>
                                            <th>Name</th>
                                            <th>Phone</th>
                                            <th>Status</th>
                                            <th>Subscribed</th>
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={subscribers()?.items ?? []}>
                                            {(s,) => (
                                                <tr>
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedIds().has(s.id,)}
                                                            onChange={() => toggleSelect(s.id,)}
                                                        />
                                                    </td>
                                                    <td>{s.email}</td>
                                                    <td>{s.name ?? ''}</td>
                                                    <td>{s.phone ?? ''}</td>
                                                    <td><span class={`badge badge--${s.status === 'subscribed' ? 'success' : 'muted'}`}>{s.status}</span></td>
                                                    <td>{new Date(s.subscribedAt,).toLocaleDateString()}</td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="btn btn--small btn--secondary"
                                                            onClick={() => setEditingSub(s,)}
                                                        >Edit</button>
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </Show>
                    </Show>

                    <Show when={showAdd()}>
                        <SubscriberFormModal
                            listId={params.id}
                            onClose={() => setShowAdd(false,)}
                            onSaved={() => { setShowAdd(false,); refetchSubs(); }}
                        />
                    </Show>
                    <Show when={editingSub()}>
                        <SubscriberFormModal
                            listId={params.id}
                            subscriber={editingSub()!}
                            onClose={() => setEditingSub(null,)}
                            onSaved={() => { setEditingSub(null,); refetchSubs(); }}
                        />
                    </Show>
                </section>
            </Show>
        </div>
    );
};

/**
 * Single row in the Subscription policy section: toggle on the
 * left, name + sub-label stacked to the right. Clicking the label
 * flips the toggle (one tap target for the whole row).
 */
interface PolicyRowProps {
    checked: boolean;
    onChange: (next: boolean,) => void;
    label: string;
    hint?: string;
}

const PolicyRow: Component<PolicyRowProps> = (p,) => (
    <label class="policy-row">
        <Toggle checked={p.checked} onChange={p.onChange} ariaLabel={p.label} />
        <div class="policy-row__text">
            <span class="policy-row__label">{p.label}</span>
            <Show when={p.hint}>
                <span class="policy-row__hint">{p.hint}</span>
            </Show>
        </div>
    </label>
);

export default MailingListEdit;
