/**
 * Embedded campaign — full detail or a teaser card.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, Campaign, } from '@sitesurge/types';
import { Component, For, Show, createResource, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import GiveButterWidget from '../GiveButterWidget';
import CampaignCard from '../CampaignCard';
import { usePluginEnabled, } from '../../../hooks/usePluginGate';

export const ALL_CAMPAIGNS_ID = '__all-campaigns__';

export const CampaignBlock: Component<{ block: Block; }> = (props,) => {
    const campaignId = () => props.block.settings.campaignId as string;
    const isAllCampaigns = () => campaignId() === ALL_CAMPAIGNS_ID;
    const gbEnabled = usePluginEnabled('givebutter',);
    // When the GiveButter plugin is on and this single campaign uses GiveButter,
    // render its donation widget inline beneath the teaser card.
    const showGiveButter = (c: Campaign | null | undefined,) =>
        !!c && gbEnabled() && c.donationProvider === 'givebutter' && !!c.givebutterCampaignCode;

    const [campaign,] = createResource(
        () => isAllCampaigns() ? null : campaignId(),
        async (id,) => {
            if (!id) return null;
            try {
                return await cms.campaigns.getById(id,) as Campaign;
            } catch {
                return null;
            }
        },
    );

    const [allCampaigns,] = createResource(
        () => isAllCampaigns() ? 'active' : null,
        async () => {
            const sortBy = (props.block.settings.sortBy as string) || 'created_at';
            const sortOrder = (props.block.settings.sortOrder as string) || 'desc';
            try {
                return await cms.campaigns.listPublic({
                    includePast: 'false',
                    activeOnly: 'true',
                    sortBy,
                    sortOrder,
                },) as Campaign[];
            } catch {
                return [];
            }
        },
    );

    const gap = () => {
        const style = props.block.style as Record<string, unknown> | undefined;
        return (style?.gap as string | undefined) || '1rem';
    };

    const direction = () => (props.block.settings.direction as string) || 'vertical';
    const isHorizontal = () => direction() === 'horizontal';

    return (
        <>
            <Show when={!isAllCampaigns() && campaign()}>
                {/* When GiveButter drives this campaign, its widget renders the
                    donation form inline — so the teaser card (a link to the campaign
                    page) is redundant. Show the widget instead of the card. */}
                <Show
                    when={showGiveButter(campaign(),)}
                    fallback={<CampaignCard campaign={campaign()!} />}
                >
                    <div class="campaign-block__givebutter">
                        <GiveButterWidget code={campaign()!.givebutterCampaignCode} type="giving-form" />
                    </div>
                </Show>
            </Show>
            <Show when={isAllCampaigns()}>
                <Show when={allCampaigns.loading}>
                    <p class="block-message">Loading campaigns...</p>
                </Show>
                <Show when={!allCampaigns.loading && allCampaigns()?.length === 0}>
                    <p class="block-message">No active campaigns.</p>
                </Show>
                <Show when={!allCampaigns.loading && (allCampaigns()?.length ?? 0) > 0}>
                    <div
                        class={`campaign-block-list ${isHorizontal() ? 'campaign-block-list--horizontal' : ''}`}
                        style={{
                            display: 'flex',
                            'flex-direction': isHorizontal() ? 'row' : 'column',
                            'flex-wrap': isHorizontal() ? 'wrap' : undefined,
                            'justify-content': isHorizontal() ? 'center' : undefined,
                            gap: gap(),
                        }}
                    >
                        <For each={allCampaigns()!}>
                            {(c,) => <CampaignCard campaign={c} />}
                        </For>
                    </div>
                </Show>
            </Show>
        </>
    );
};
