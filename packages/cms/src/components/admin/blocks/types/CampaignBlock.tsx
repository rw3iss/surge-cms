import { Component, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import { getCampaigns, } from '@/services/adminData';
import { FormField, } from '../../forms';

const ALL_CAMPAIGNS_ID = '__all-campaigns__';

const SORT_OPTIONS = [
    { value: 'created_at', label: 'Date Created', },
    { value: 'start_date', label: 'Date Started', },
    { value: 'end_date', label: 'Date Ended', },
    { value: 'current_amount_cents', label: 'Total Donated ($)', },
    { value: 'donation_percent', label: 'Total Donated (%)', },
    { value: 'goal_amount_cents', label: 'Campaign Goal', },
    { value: 'donor_count', label: 'Donor Count', },
];

interface CampaignBlockProps {
    data: Record<string, any>;
    mode: string;
    onUpdate: (data: Record<string, any>,) => void;
}

const CampaignBlock: Component<CampaignBlockProps> = (props,) => {
    const [search, setSearch,] = createSignal(
        props.data.campaignId === ALL_CAMPAIGNS_ID ? '' : (props.data.title || props.data.campaignId || ''),
    );
    const [showDropdown, setShowDropdown,] = createSignal(false,);
    let containerRef: HTMLDivElement | undefined;

    const [campaigns,] = createResource(async () => getCampaigns(),);

    const isAllSelected = () => props.data.campaignId === ALL_CAMPAIGNS_ID;

    const filtered = () => {
        const items = campaigns() || [];
        const q = search().toLowerCase().trim();
        if (!q) return items;
        return items.filter(
            (c,) => c.title?.toLowerCase().includes(q,) || c.slug?.toLowerCase().includes(q,),
        );
    };

    const selectCampaign = (campaign: any,) => {
        props.onUpdate({
            ...props.data,
            campaignId: campaign.id,
            title: campaign.title,
            slug: campaign.slug,
        },);
        setSearch(campaign.title,);
        setShowDropdown(false,);
    };

    const selectAll = () => {
        props.onUpdate({
            ...props.data,
            campaignId: ALL_CAMPAIGNS_ID,
            title: 'All Active Campaigns',
            slug: undefined,
            sortBy: props.data.sortBy || 'created_at',
            sortOrder: props.data.sortOrder || 'desc',
        },);
        setSearch('',);
        setShowDropdown(false,);
    };

    const handleClickOutside = (e: MouseEvent,) => {
        if (containerRef && !containerRef.contains(e.target as Node,)) {
            setShowDropdown(false,);
        }
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside,);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside,),);
    }

    return (
        <div class="block-campaign">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-reference__preview">
                        <Show
                            when={props.data.campaignId}
                            fallback={
                                <span class="block-text__empty">
                                    No campaign selected. Click Edit to choose one.
                                </span>
                            }
                        >
                            <span>
                                Campaign: <strong>
                                    {isAllSelected() ? 'All Active Campaigns' : (props.data.title || props.data.campaignId)}
                                </strong>
                            </span>
                        </Show>
                    </div>
                }
            >
                <div class="form-group" ref={containerRef} style={{ position: 'relative', }}>
                    <label>Campaign</label>
                    <input
                        type="text"
                        value={isAllSelected() ? 'All Active Campaigns' : search()}
                        onInput={(e,) => {
                            setSearch(e.currentTarget.value,);
                            setShowDropdown(true,);
                        }}
                        onFocus={() => setShowDropdown(true,)}
                        placeholder="Search campaigns by name..."
                        autocomplete="off"
                    />
                    <Show when={showDropdown()}>
                        <div class="block-campaign__dropdown">
                            <button
                                type="button"
                                class={`block-campaign__option block-campaign__option--all ${
                                    isAllSelected() ? 'block-campaign__option--selected' : ''
                                }`}
                                onClick={selectAll}
                            >
                                <span class="block-campaign__option-title">All Active Campaigns</span>
                                <span class="block-campaign__option-meta">
                                    Displays all active campaigns in a list
                                </span>
                            </button>

                            <Show when={filtered().length > 0}>
                                <For each={filtered()}>
                                    {(campaign,) => (
                                        <button
                                            type="button"
                                            class={`block-campaign__option ${
                                                props.data.campaignId === campaign.id ?
                                                    'block-campaign__option--selected' : ''
                                            }`}
                                            onClick={() => selectCampaign(campaign,)}
                                        >
                                            <span class="block-campaign__option-title">{campaign.title}</span>
                                            <span class="block-campaign__option-meta">
                                                /{campaign.slug}
                                                <Show when={campaign.status}>
                                                    {' '}&middot; {campaign.status as string}
                                                </Show>
                                            </span>
                                        </button>
                                    )}
                                </For>
                            </Show>

                            <Show when={filtered().length === 0 && search()}>
                                <div class="empty-state">No campaigns found</div>
                            </Show>
                        </div>
                    </Show>
                </div>

                {/* Sort options — only shown for "All Campaigns" */}
                <Show when={isAllSelected()}>
                    <FormField label="Sort By">
                        <select
                            value={props.data.sortBy || 'created_at'}
                            onChange={(e,) => props.onUpdate({ ...props.data, sortBy: e.currentTarget.value, },)}
                        >
                            <For each={SORT_OPTIONS}>
                                {(opt,) => <option value={opt.value}>{opt.label}</option>}
                            </For>
                        </select>
                    </FormField>
                    <FormField label="Sort Direction">
                        <select
                            value={props.data.sortOrder || 'desc'}
                            onChange={(e,) => props.onUpdate({ ...props.data, sortOrder: e.currentTarget.value, },)}
                        >
                            <option value="desc">Descending (newest/highest first)</option>
                            <option value="asc">Ascending (oldest/lowest first)</option>
                        </select>
                    </FormField>
                    <FormField label="Layout Direction">
                        <select
                            value={props.data.direction || 'vertical'}
                            onChange={(e,) => props.onUpdate({ ...props.data, direction: e.currentTarget.value, },)}
                        >
                            <option value="vertical">Vertical (stacked)</option>
                            <option value="horizontal">Horizontal (side by side)</option>
                        </select>
                    </FormField>
                </Show>
            </Show>
        </div>
    );
};

export default CampaignBlock;
