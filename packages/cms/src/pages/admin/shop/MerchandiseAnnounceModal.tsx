/**
 * Confirm and send a new-merchandise announcement.
 *
 * Publishing a product no longer emails anyone — it leaves the product
 * *pending*. This is the step that turns a batch of pending products into ONE
 * email, and it is deliberately a review screen rather than a button:
 *
 *  - every pending product starts selected, but any can be dropped (a supplier
 *    sync can publish things you did not mean to announce);
 *  - already-announced products can be added back in, for a re-run;
 *  - the preview is rendered by the SAME mail renderer that will send it, so
 *    what you approve is what goes out.
 */
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { ShopProduct, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';
import ModalShell from '../../../components/admin/common/ModalShell';
import FormField from '../../../components/admin/forms/FormField';

interface PendingProduct {
    id: string;
    title: string;
    slug: string;
    priceCents: number | null;
    imageUrl: string | null;
    createdAt: string;
}

export interface MerchandiseAnnounceModalProps {
    pending: PendingProduct[];
    /** Fired after a successful send so the dashboard can refresh its count. */
    onSent: () => void;
    onClose: () => void;
}

const MerchandiseAnnounceModal: Component<MerchandiseAnnounceModalProps> = (props,) => {
    const toast = useToast();

    // Everything pending starts included — that is the common case, and
    // unchecking is easier than hunting for what to add.
    const [selected, setSelected,] = createSignal<Set<string>>(
        new Set(props.pending.map((p,) => p.id),),
    );
    // Extra products the operator pulled in that weren't pending.
    const [extras, setExtras,] = createSignal<PendingProduct[]>([],);
    const [subject, setSubject,] = createSignal('',);
    const [intro, setIntro,] = createSignal('',);
    const [sending, setSending,] = createSignal(false,);
    // Open the picker up front when there is nothing pending — otherwise the
    // modal presents an empty list and a disabled Send button with no obvious
    // next step.
    const [showPicker, setShowPicker,] = createSignal(props.pending.length === 0,);
    const [previewOpen, setPreviewOpen,] = createSignal(false,);

    const all = () => [...props.pending, ...extras(),];
    const chosenIds = () => all().filter((p,) => selected().has(p.id,)).map((p,) => p.id);

    const selectAll = () => setSelected(new Set<string>(all().map((p,) => p.id),),);
    const deselectAll = () => setSelected(new Set<string>(),);

    /** Pull every remaining live product into the list, already selected. */
    const addAll = () => {
        const remaining = (addable() ?? []).filter((p,) => !all().some((x,) => x.id === p.id));
        if (remaining.length === 0) return;
        setExtras((prev,) => [...prev, ...remaining.map((p,) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            priceCents: p.fromPriceCents ?? null,
            imageUrl: p.primaryImageUrl ?? null,
            createdAt: p.createdAt ?? '',
        })),],);
        setSelected((prev,) => {
            const next = new Set(prev,);
            for (const p of remaining) next.add(p.id,);
            return next;
        },);
        setShowPicker(false,);
    };

    const toggle = (id: string,) =>
        setSelected((prev,) => {
            const next = new Set(prev,);
            if (next.has(id,)) next.delete(id,);
            else next.add(id,);
            return next;
        },);

    /** Live products not already listed — the "add another" pool. */
    const [addable] = createResource(async () => {
        try {
            const res = await cms.shop.products.list({ limit: 100, } as never,);
            return ((res.data ?? []) as ShopProduct[]).filter((p,) => p.status === 'active');
        } catch {
            return [] as ShopProduct[];
        }
    },);

    const addProduct = (p: ShopProduct,) => {
        if (all().some((x,) => x.id === p.id)) return;
        setExtras((prev,) => [...prev, {
            id: p.id,
            title: p.title,
            slug: p.slug,
            priceCents: p.fromPriceCents ?? null,
            imageUrl: p.primaryImageUrl ?? null,
            createdAt: p.createdAt ?? '',
        },],);
        setSelected((prev,) => new Set(prev,).add(p.id,),);
        setShowPicker(false,);
    };

    // Re-renders whenever the selection, subject or intro changes, so the
    // preview can never show a different email from the one that will send.
    const [preview] = createResource(
        () => (previewOpen() ? { ids: chosenIds(), subject: subject(), intro: intro(), } : null),
        async (args,) => {
            if (args.ids.length === 0) return '';
            try {
                const r = await cms.shop.merchandise.preview({
                    productIds: args.ids,
                    subject: args.subject || undefined,
                    intro: args.intro || undefined,
                },);
                return r.html;
            } catch {
                return '';
            }
        },
    );

    const send = async () => {
        if (chosenIds().length === 0) return;
        setSending(true,);
        try {
            const r = await cms.shop.merchandise.announce({
                productIds: chosenIds(),
                subject: subject() || undefined,
                intro: intro() || undefined,
            },);
            toast.success(
                `Announcement queued — ${r.products} product${r.products === 1 ? '' : 's'} `
                    + `to ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}.`,
            );
            props.onSent();
            props.onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not send the announcement.',);
        } finally {
            setSending(false,);
        }
    };

    const money = (cents: number | null,) => (cents == null ? '' : `$${(cents / 100).toFixed(2,)}`);

    return (
        <ModalShell
            open
            onClose={props.onClose}
            size="lg"
            showClose
            ariaLabel="Announce new merchandise"
            class="merch-announce"
        >
            <h2 class="merch-announce__title">Announce new merchandise</h2>
            <p class="form-help-muted">
                One email to your new-merchandise list, covering everything selected below.
                Sent through the normal campaign pipeline, so it is batched and retried like
                any other send.
            </p>

            <div class="merch-announce__products">
                <Show when={all().length === 0}>
                    <p class="form-help-muted merch-announce__empty">
                        No products selected yet — add the ones you want to announce below.
                    </p>
                </Show>
                <For each={all()}>
                    {(p,) => (
                        <label
                            class="merch-announce__product"
                            classList={{ 'is-off': !selected().has(p.id,), }}
                        >
                            <input
                                type="checkbox"
                                checked={selected().has(p.id,)}
                                onChange={() => toggle(p.id,)}
                            />
                            <Show when={p.imageUrl}>
                                <img src={p.imageUrl!} alt="" class="merch-announce__thumb" />
                            </Show>
                            <span class="merch-announce__name">{p.title}</span>
                            <span class="merch-announce__price">{money(p.priceCents,)}</span>
                        </label>
                    )}
                </For>
            </div>

            <div class="merch-announce__add">
                <div class="merch-announce__add-row">
                    <button
                        type="button"
                        class="ui-button ui-button--sm ui-button--secondary"
                        onClick={() => setShowPicker((v,) => !v)}
                    >
                        {showPicker() ? 'Cancel' : '+ Add another product'}
                    </button>
                    {/* Bulk selection acts on the list above, not the picker —
                        with a full catalogue it is the difference between one
                        click and twenty. Hidden while the list is empty, where
                        both would be no-ops. */}
                    <Show when={all().length > 1}>
                        <button
                            type="button"
                            class="ui-button ui-button--sm ui-button--ghost"
                            onClick={selectAll}
                            disabled={chosenIds().length === all().length}
                        >
                            Select all
                        </button>
                        <button
                            type="button"
                            class="ui-button ui-button--sm ui-button--ghost"
                            onClick={deselectAll}
                            disabled={chosenIds().length === 0}
                        >
                            Deselect all
                        </button>
                    </Show>
                </div>
                <Show when={showPicker()}>
                    <div class="merch-announce__picker">
                        {/* With nothing pending the list starts empty, so
                            "Select all" has nothing to act on — this is the
                            one-click path for announcing a whole catalogue. */}
                        <Show
                            when={(addable() ?? []).filter((p,) => !all().some((x,) => x.id === p.id)).length > 1}
                        >
                            <button
                                type="button"
                                class="merch-announce__picker-item merch-announce__picker-all"
                                onClick={addAll}
                            >
                                + Add all
                            </button>
                        </Show>
                        <For
                            each={(addable() ?? []).filter((p,) => !all().some((x,) => x.id === p.id))}
                            fallback={<p class="form-help-muted">No other live products.</p>}
                        >
                            {(p,) => (
                                <button
                                    type="button"
                                    class="merch-announce__picker-item"
                                    onClick={() => addProduct(p,)}
                                >
                                    {p.title}
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <FormField label="Subject" hint="Leave blank to use the template's default.">
                <input
                    type="text"
                    value={subject()}
                    onBlur={(e,) => setSubject(e.currentTarget.value,)}
                    placeholder="New arrivals"
                />
            </FormField>

            <FormField label="Intro" hint="Optional HTML shown above the product grid.">
                <textarea
                    rows={2}
                    value={intro()}
                    onBlur={(e,) => setIntro(e.currentTarget.value,)}
                    placeholder="<p>Just landed…</p>"
                />
            </FormField>

            <div class="merch-announce__preview-toggle">
                <button
                    type="button"
                    class="ui-button ui-button--sm ui-button--secondary"
                    onClick={() => setPreviewOpen((v,) => !v)}
                    disabled={chosenIds().length === 0}
                >
                    {previewOpen() ? 'Hide preview' : 'Preview email'}
                </button>
            </div>

            <Show when={previewOpen()}>
                <Show
                    when={!preview.loading}
                    fallback={<div class="empty-state">Rendering…</div>}
                >
                    <Show
                        when={preview()}
                        fallback={<div class="empty-state">Nothing to preview.</div>}
                    >
                        {/* Sandboxed: the preview is real email HTML with its own
                            styles, and must not inherit or leak the admin's. */}
                        <iframe
                            class="merch-announce__preview"
                            title="Email preview"
                            sandbox=""
                            srcdoc={preview()!}
                        />
                    </Show>
                </Show>
            </Show>

            <div class="merch-announce__actions">
                <span class="form-help-muted">
                    {chosenIds().length} product{chosenIds().length === 1 ? '' : 's'} selected
                </span>
                <button class="ui-button ui-button--secondary" onClick={props.onClose} disabled={sending()}>
                    Cancel
                </button>
                <button
                    class="ui-button ui-button--primary"
                    onClick={() => void send()}
                    disabled={sending() || chosenIds().length === 0}
                >
                    {sending() ? 'Sending…' : 'Send announcement'}
                </button>
            </div>
        </ModalShell>
    );
};

export default MerchandiseAnnounceModal;
