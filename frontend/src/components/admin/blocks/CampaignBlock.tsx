import { Component, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';
import { getCampaigns, } from '../../../services/adminData';

interface CampaignBlockProps {
    data: Record<string, any>;
    mode: string;
    onUpdate: (data: Record<string, any>,) => void;
}

const CampaignBlock: Component<CampaignBlockProps> = (props,) => {
    const [search, setSearch,] = createSignal(props.data.title || props.data.campaignId || '',);
    const [showDropdown, setShowDropdown,] = createSignal(false,);
    let containerRef: HTMLDivElement | undefined;

    const [campaigns,] = createResource(async () => getCampaigns(),);

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
                                Campaign: <strong>{props.data.title || props.data.campaignId}</strong>
                            </span>
                        </Show>
                    </div>
                }
            >
                <div class="form-group" ref={containerRef} style={{ position: 'relative', }}>
                    <label>Campaign</label>
                    <input
                        type="text"
                        value={search()}
                        onInput={(e,) => {
                            setSearch(e.currentTarget.value,);
                            setShowDropdown(true,);
                        }}
                        onFocus={() => setShowDropdown(true,)}
                        placeholder="Search campaigns by name..."
                        autocomplete="off"
                    />
                    <Show when={showDropdown() && filtered().length > 0}>
                        <div class="block-campaign__dropdown">
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
                        </div>
                    </Show>
                    <Show when={showDropdown() && filtered().length === 0 && search()}>
                        <div class="block-campaign__dropdown">
                            <div class="block-campaign__empty">No campaigns found</div>
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default CampaignBlock;
