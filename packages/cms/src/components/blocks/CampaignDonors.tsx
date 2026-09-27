import type { PublicDonation, } from '@sitesurge/types';
import { Component, createEffect, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';

const PAGE_SIZE = 25;

/**
 * "Recent Donors" — a campaign's donations, most recent first, in a scrolling
 * list that loads the next 25 as the reader nears the bottom.
 *
 * Each donation's own visibility is applied by the SERVER (the public
 * donations endpoint): `anonymous` arrives named "Anonymous", `hidden` never
 * arrives at all — it still counts toward the raised total, which comes from
 * the campaign, not from this list.
 *
 * `showAmounts=false` (the campaign's "Show raised amount" is off) drops the
 * per-donor amounts too: that switch promises no monetary figures at all.
 */
const CampaignDonors: Component<{ campaignId: string; showAmounts?: boolean; }> = (props,) => {
    const [rows, setRows,] = createSignal<PublicDonation[]>([],);
    const [page, setPage,] = createSignal(0,);
    const [total, setTotal,] = createSignal<number | null>(null,);
    const [loading, setLoading,] = createSignal(false,);
    let listEl: HTMLDivElement | undefined;
    let sentinel: HTMLDivElement | undefined;

    const hasMore = () => total() === null || rows().length < (total() ?? 0);

    const loadMore = async () => {
        if (loading() || !hasMore()) return;
        setLoading(true,);
        const id = props.campaignId;
        try {
            const next = page() + 1;
            const res = await cms.campaigns.donations(id, { page: next, limit: PAGE_SIZE, },);
            if (id !== props.campaignId) return; // campaign changed mid-request
            setRows((prev,) => [...prev, ...(res.data as PublicDonation[]),]);
            setTotal(res.meta?.total ?? 0,);
            setPage(next,);
        } catch {
            setTotal(rows().length,); // stop retrying on failure
        } finally {
            setLoading(false,);
        }
    };

    // (Re)start whenever the campaign changes.
    createEffect(on(() => props.campaignId, () => {
        setRows([],);
        setPage(0,);
        setTotal(null,);
        void loadMore();
    },),);

    // Load the next page when the bottom sentinel scrolls into the list's view.
    createEffect(() => {
        if (!sentinel || !listEl || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver((entries,) => {
            if (entries.some((e,) => e.isIntersecting)) void loadMore();
        }, { root: listEl, rootMargin: '0px 0px 80px 0px', },);
        io.observe(sentinel,);
        onCleanup(() => io.disconnect());
    },);

    const money = (cents: number,) =>
        `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, },)}`;
    const date = (d: string,) =>
        new Date(d,).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', },);

    return (
        <div class="campaign-donors">
            <h3 class="campaign-donors__title">Recent Donors</h3>
            <Show
                when={rows().length > 0 || loading()}
                fallback={<p class="campaign-donors__empty">Be the first to donate.</p>}
            >
                <div class="campaign-donors__list" ref={listEl}>
                    <ul>
                        <For each={rows()}>
                            {(d,) => (
                                <li class="campaign-donors__item">
                                    <span class="campaign-donors__name">{d.donorName || 'Anonymous'}</span>
                                    <Show when={props.showAmounts !== false}>
                                        <span class="campaign-donors__amount">{money(d.amountCents,)}</span>
                                    </Show>
                                    <span class="campaign-donors__date">{date(d.createdAt,)}</span>
                                </li>
                            )}
                        </For>
                    </ul>
                    <div ref={sentinel} class="campaign-donors__more">
                        <Show when={loading()}>Loading more…</Show>
                        <Show when={!loading() && hasMore() && rows().length > 0}>Scroll for more</Show>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default CampaignDonors;
