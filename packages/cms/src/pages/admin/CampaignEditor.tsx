import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/common/AutoSaveIndicator';
import Toggle from '../../components/admin/common/Toggle';
import { FormField, } from '../../components/admin/forms';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidateCampaignsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';
import { usePluginEnabled, } from '../../hooks/usePluginGate';

interface GbCampaign { id: number; code: string; title: string; }

const CampaignEditor: Component = () => {
    const params = useParams<{ id: string, }>();
    const navigate = useNavigate();
    const isNew = () => !params.id || params.id === 'new';
    const { markDirty, markClean, } = useUnsavedChanges();

    const { error, saving, beginSave, endSave, showError, } = useEditorState();

    // Form state
    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [shortDescription, setShortDescription,] = createSignal('',);
    const [goalAmount, setGoalAmount,] = createSignal<string>('',);
    const [hasGoal, setHasGoal,] = createSignal(true,);
    const [showRaisedAmount, setShowRaisedAmount,] = createSignal(true,);
    const [status, setStatus,] = createSignal('draft',);
    const [isPublished, setIsPublished,] = createSignal(false,);
    const [startDate, setStartDate,] = createSignal('',);
    const [endDate, setEndDate,] = createSignal('',);
    const [featuredImage, setFeaturedImage,] = createSignal('',);

    // GiveButter (only surfaced when the plugin is enabled)
    const gbAvailable = usePluginEnabled('givebutter',);
    const [donationProvider, setDonationProvider,] = createSignal<'internal' | 'givebutter'>('internal',);
    const [gbMode, setGbMode,] = createSignal<'link' | 'create'>('link',);
    const [gbCampaignId, setGbCampaignId,] = createSignal<number | null>(null,);
    const [gbCampaignCode, setGbCampaignCode,] = createSignal('',);
    const [gbList, setGbList,] = createSignal<GbCampaign[]>([],);
    const [gbLoadingList, setGbLoadingList,] = createSignal(false,);
    const [gbStatus, setGbStatus,] = createSignal('',);

    const loadGbCampaigns = async () => {
        setGbLoadingList(true,); setGbStatus('Loading GiveButter campaigns…',);
        try {
            const r = await cms.plugins.action<{ ok: boolean; campaigns?: GbCampaign[]; error?: string; }>(
                'givebutter', 'listCampaigns', {},
            );
            if (r?.ok && r.campaigns) { setGbList(r.campaigns,); setGbStatus(`${r.campaigns.length} campaign(s) loaded`,); }
            else { setGbStatus(r?.error || 'Failed to load campaigns',); }
        } catch (err) {
            setGbStatus(err instanceof Error ? err.message : 'Failed to load campaigns',);
        } finally {
            setGbLoadingList(false,);
        }
    };

    // Load existing campaign
    const [campaign,] = createResource(
        () => !isNew() ? params.id : null,
        async (id,) => {
            let data: any = null;
            try {
                data = await cms.campaigns.getById(id,);
            } catch {
                return null;
            }
            if (data) {
                setTitle(data.title || '',);
                setSlug(data.slug || '',);
                setDescription(data.description || '',);
                setShortDescription(data.shortDescription || '',);
                if (data.goalAmountCents !== null && data.goalAmountCents !== undefined) {
                    setGoalAmount((data.goalAmountCents / 100).toString(),);
                    setHasGoal(true,);
                } else {
                    setGoalAmount('',);
                    setHasGoal(false,);
                }
                setShowRaisedAmount(data.showRaisedAmount ?? true,);
                setStatus(data.status || 'draft',);
                setIsPublished(data.isPublished ?? false,);
                if (data.startDate) {
                    setStartDate(new Date(data.startDate,).toISOString().slice(0, 16,),);
                }
                if (data.endDate) {
                    setEndDate(new Date(data.endDate,).toISOString().slice(0, 16,),);
                }
                setFeaturedImage(data.featuredImage || '',);
                setDonationProvider(data.donationProvider === 'givebutter' ? 'givebutter' : 'internal',);
                setGbCampaignId(data.givebutterCampaignId ?? null,);
                setGbCampaignCode(data.givebutterCampaignCode || '',);
                // If already linked, default the mode to link; otherwise create.
                setGbMode(data.givebutterCampaignCode ? 'link' : 'link',);
                return data;
            }
            return null;
        },
    );

    const generateSlug = (text: string,) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-',)
            .replace(/(^-|-$)/g, '',);
    };

    const handleTitleChange = (e: Event,) => {
        const value = (e.target as HTMLInputElement).value;
        setTitle(value,);
        if (isNew()) {
            setSlug(generateSlug(value,),);
        }
        markDirty();
    };

    // Auto-save draft to localStorage
    const autoSave = useAutoSave({
        key: `campaign-draft-${params.id || 'new'}`,
        state: () => ({
            title: title(),
            slug: slug(),
            description: description(),
            shortDescription: shortDescription(),
            goalAmount: goalAmount(),
            hasGoal: hasGoal(),
            showRaisedAmount: showRaisedAmount(),
            status: status(),
            isPublished: isPublished(),
            startDate: startDate(),
            endDate: endDate(),
            featuredImage: featuredImage(),
        }),
    },);

    const handleSubmit = async (e?: Event,) => {
        e?.preventDefault();
        beginSave();

        try {
            // GiveButter: when the provider is GiveButter in "create" mode and not
            // yet linked, create the GiveButter campaign first and capture its
            // id + widget code so the saved CMS campaign carries the mapping.
            let gbId = gbCampaignId();
            let gbCode = gbCampaignCode();
            if (gbAvailable() && donationProvider() === 'givebutter' && gbMode() === 'create' && !gbId) {
                const res = await cms.plugins.action<{ ok: boolean; error?: string; campaign?: { id: number; code: string; }; }>(
                    'givebutter', 'createCampaign', {
                        title: title(),
                        description: shortDescription() || description(),
                        goal: hasGoal() && goalAmount() ? Math.round(parseFloat(goalAmount(),) * 100,) : undefined,
                        end_at: endDate() ? new Date(endDate(),).toISOString() : undefined,
                    },
                );
                if (!res?.ok || !res.campaign?.code) {
                    setGbStatus(res?.error || 'GiveButter campaign creation failed',);
                    showError(res?.error || 'GiveButter campaign creation failed', 'GiveButter error',);
                    endSave();
                    return;
                }
                gbId = res.campaign.id;
                gbCode = res.campaign.code;
                setGbCampaignId(gbId,);
                setGbCampaignCode(gbCode,);
            }

            const payload = {
                title: title(),
                slug: slug(),
                description: description(),
                shortDescription: shortDescription(),
                goalAmountCents: hasGoal() && goalAmount() ? Math.round(parseFloat(goalAmount(),) * 100,) : null,
                showRaisedAmount: showRaisedAmount(),
                status: status(),
                isPublished: isPublished(),
                startDate: startDate() ? new Date(startDate(),).toISOString() : null,
                endDate: endDate() ? new Date(endDate(),).toISOString() : null,
                featuredImage: featuredImage() || null,
                ...(gbAvailable()
                    ? {
                        donationProvider: donationProvider(),
                        givebutterCampaignId: donationProvider() === 'givebutter' ? gbId : null,
                        givebutterCampaignCode: donationProvider() === 'givebutter' ? (gbCode || null) : null,
                    }
                    : {}),
            };

            if (isNew()) {
                await cms.campaigns.create(payload as any,);
            } else {
                await cms.campaigns.update(params.id, payload as any,);
            }

            invalidateCampaignsCache();
            autoSave.clear();
            markClean();
            navigate('/admin/campaigns',);
        } catch (err) {
            showError(err, 'An error occurred while saving',);
        } finally {
            endSave();
        }
    };

    useKeyboardShortcuts([
        { key: 's', ctrl: true, handler: () => handleSubmit(), },
    ],);

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this campaign? This cannot be undone.',)) {
            return;
        }

        try {
            await cms.campaigns.remove(params.id,);
            invalidateCampaignsCache();
            navigate('/admin/campaigns',);
        } catch (err) {
            showError(err, 'An error occurred while deleting',);
        }
    };

    return (
        <div class="admin-editor">
            <Title>{isNew() ? 'New Campaign' : 'Edit Campaign'} - Admin - RW</Title>

            <div class="admin-header">
                <h1>{isNew() ? 'New Campaign' : 'Edit Campaign'}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={isNew() || campaign()} fallback={<div>Loading...</div>}>
                <form onSubmit={handleSubmit} class="admin-form">
                    {/* GiveButter donation-provider panel (only when the plugin is enabled). */}
                    <Show when={gbAvailable()}>
                        <div class="form-section gb-panel">
                            <h3 class="gb-panel__title">Donations</h3>
                            <Show when={donationProvider() === 'givebutter'}>
                                <div class="gb-panel__badge">
                                    GiveButter is managing donations for this campaign.
                                </div>
                            </Show>
                            <FormField label="Donation provider" hint="Choose which platform collects donations for this campaign.">
                                <select
                                    value={donationProvider()}
                                    onChange={(e,) => {
                                        setDonationProvider((e.currentTarget.value as 'internal' | 'givebutter'),);
                                        markDirty();
                                    }}
                                >
                                    <option value="internal">Internal (Stripe)</option>
                                    <option value="givebutter">GiveButter</option>
                                </select>
                            </FormField>

                            <Show when={donationProvider() === 'givebutter'}>
                                <FormField label="GiveButter campaign">
                                    <select
                                        value={gbMode()}
                                        onChange={(e,) => {
                                            setGbMode((e.currentTarget.value as 'link' | 'create'),);
                                            markDirty();
                                        }}
                                    >
                                        <option value="link">Link an existing GiveButter campaign</option>
                                        <option value="create">Create a new GiveButter campaign on save</option>
                                    </select>
                                </FormField>

                                <Show when={gbMode() === 'link'}>
                                    <div class="form-group">
                                        <button
                                            type="button"
                                            class="btn btn--secondary btn--small"
                                            disabled={gbLoadingList()}
                                            onClick={loadGbCampaigns}
                                        >
                                            {gbLoadingList() ? 'Loading…' : 'Load GiveButter campaigns'}
                                        </button>
                                        <Show when={gbList().length > 0}>
                                            <select
                                                class="gb-panel__list"
                                                value={gbCampaignId() != null ? String(gbCampaignId(),) : ''}
                                                onChange={(e,) => {
                                                    const picked = gbList().find((c,) => String(c.id,) === e.currentTarget.value);
                                                    if (picked) { setGbCampaignId(picked.id,); setGbCampaignCode(picked.code,); markDirty(); }
                                                }}
                                            >
                                                <option value="">— select a campaign —</option>
                                                <For each={gbList()}>
                                                    {(c,) => <option value={String(c.id,)}>{c.code} — {c.title}</option>}
                                                </For>
                                            </select>
                                        </Show>
                                    </div>
                                    <FormField label="…or enter a campaign code" hint="The 6-character code near the campaign title in your GiveButter dashboard.">
                                        <input
                                            type="text"
                                            value={gbCampaignCode()}
                                            onInput={(e,) => { setGbCampaignCode((e.target as HTMLInputElement).value,); markDirty(); }}
                                            placeholder="6-character GiveButter code"
                                            maxLength={16}
                                        />
                                    </FormField>
                                </Show>

                                <Show when={gbMode() === 'create'}>
                                    <small class="form-help">
                                        A GiveButter campaign will be created from this campaign's title, goal,
                                        and description when you save.
                                    </small>
                                </Show>

                                <Show when={!gbCampaignCode()}>
                                    <div class="alert alert--warning gb-panel__warning">
                                        ⚠ No GiveButter campaign is linked yet — donations can't render on the
                                        public site until you link or create one.
                                    </div>
                                </Show>

                                <Show when={gbStatus()}>
                                    <small class="form-help gb-panel__status">{gbStatus()}</small>
                                </Show>
                            </Show>
                        </div>
                    </Show>

                    {/* Single two-column layout: content + fundraising goal on
                        the left, publishing controls + schedule on the right */}
                    <div class="form-section form-columns">
                        <div class="form-columns__main">
                            <FormField label="Title *">
                                <input
                                    type="text"
                                    value={title()}
                                    onInput={handleTitleChange}
                                    required
                                    placeholder="Campaign title"
                                />
                            </FormField>

                            <FormField label="URL Slug *">
                                <input
                                    type="text"
                                    value={slug()}
                                    onInput={(e,) => {
                                        setSlug((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    required
                                    placeholder="campaign-url-slug"
                                />
                                <small class="form-help">Used in the URL: /campaigns/{slug() || 'slug'}</small>
                            </FormField>

                            <FormField label="Short Description">
                                <input
                                    type="text"
                                    value={shortDescription()}
                                    onInput={(e,) => {
                                        setShortDescription((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    placeholder="Brief description for listings"
                                    maxLength={200}
                                />
                            </FormField>

                            <FormField label="Full Description *">
                                <textarea
                                    value={description()}
                                    onInput={(e,) => {
                                        setDescription((e.target as HTMLTextAreaElement).value,);
                                        markDirty();
                                    }}
                                    required
                                    placeholder="Detailed description of the campaign..."
                                    rows={6}
                                />
                            </FormField>

                            <FormField label="Featured Image URL">
                                <input
                                    type="url"
                                    value={featuredImage()}
                                    onInput={(e,) => {
                                        setFeaturedImage((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    placeholder="https://..."
                                />
                            </FormField>

                            <div class="form-group">
                                <Toggle
                                    checked={hasGoal()}
                                    onChange={(next,) => { setHasGoal(next,); markDirty(); }}
                                    label="Set a fundraising goal"
                                />
                            </div>

                            <div class="form-group">
                                <Toggle
                                    checked={showRaisedAmount()}
                                    onChange={(next,) => { setShowRaisedAmount(next,); markDirty(); }}
                                    label="Show raised amount"
                                />
                                <small class="form-help">
                                    When off, the public campaign shows no monetary information
                                    at all — no amount raised, goal, or progress bar.
                                </small>
                            </div>

                            <Show when={hasGoal()}>
                                <FormField label="Goal Amount ($)" hint="Leave empty for an open/unlimited fund">
                                    <input
                                        type="number"
                                        value={goalAmount()}
                                        onInput={(e,) => {
                                            setGoalAmount((e.target as HTMLInputElement).value,);
                                            markDirty();
                                        }}
                                        placeholder="10000"
                                        min="0"
                                        step="0.01"
                                    />
                                </FormField>
                            </Show>
                        </div>

                        <div class="form-columns__side">
                            <div class="form-group">
                                <Toggle
                                    checked={isPublished()}
                                    onChange={(next,) => { setIsPublished(next,); markDirty(); }}
                                    label="Published (visible to the public)"
                                />
                            </div>

                            <FormField label="Status">
                                <select
                                    value={status()}
                                    onChange={(e,) => {
                                        setStatus((e.target as HTMLSelectElement).value,);
                                        markDirty();
                                    }}
                                >
                                    <option value="draft">Draft</option>
                                    <option value="active">Active</option>
                                    <option value="completed">Completed</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </FormField>

                            <FormField label="Start Date" hint="When the campaign starts accepting donations (optional)">
                                <input
                                    type="datetime-local"
                                    value={startDate()}
                                    onInput={(e,) => {
                                        setStartDate((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                />
                            </FormField>
                            <FormField label="End Date" hint="When the campaign stops accepting donations (optional)">
                                <input
                                    type="datetime-local"
                                    value={endDate()}
                                    onInput={(e,) => {
                                        setEndDate((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                />
                            </FormField>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button type="submit" class="btn btn--primary" disabled={saving()}>
                            {saving() ? 'Saving...' : 'Save Campaign'}
                        </button>
                        <button type="button" class="btn btn--secondary" onClick={() => navigate('/admin/campaigns',)}>
                            Cancel
                        </button>
                        <Show when={!isNew()}>
                            <button type="button" class="btn btn--danger" onClick={handleDelete}>
                                Delete
                            </button>
                        </Show>
                    </div>
                </form>
            </Show>
        </div>
    );
};

export default CampaignEditor;
