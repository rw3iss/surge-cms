import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createResource, createSignal, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/common/AutoSaveIndicator';
import Toggle from '../../components/admin/common/Toggle';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidateCampaignsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';

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
                    {/* Single two-column layout: content + fundraising goal on
                        the left, publishing controls + schedule on the right */}
                    <div class="form-section form-columns">
                        <div class="form-columns__main">
                            <div class="form-group">
                                <label for="title">Title *</label>
                                <input
                                    type="text"
                                    id="title"
                                    value={title()}
                                    onInput={handleTitleChange}
                                    required
                                    placeholder="Campaign title"
                                />
                            </div>

                            <div class="form-group">
                                <label for="slug">URL Slug *</label>
                                <input
                                    type="text"
                                    id="slug"
                                    value={slug()}
                                    onInput={(e,) => {
                                        setSlug((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    required
                                    placeholder="campaign-url-slug"
                                />
                                <small class="form-help">Used in the URL: /campaigns/{slug() || 'slug'}</small>
                            </div>

                            <div class="form-group">
                                <label for="shortDescription">Short Description</label>
                                <input
                                    type="text"
                                    id="shortDescription"
                                    value={shortDescription()}
                                    onInput={(e,) => {
                                        setShortDescription((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    placeholder="Brief description for listings"
                                    maxLength={200}
                                />
                            </div>

                            <div class="form-group">
                                <label for="description">Full Description *</label>
                                <textarea
                                    id="description"
                                    value={description()}
                                    onInput={(e,) => {
                                        setDescription((e.target as HTMLTextAreaElement).value,);
                                        markDirty();
                                    }}
                                    required
                                    placeholder="Detailed description of the campaign..."
                                    rows={6}
                                />
                            </div>

                            <div class="form-group">
                                <label for="featuredImage">Featured Image URL</label>
                                <input
                                    type="url"
                                    id="featuredImage"
                                    value={featuredImage()}
                                    onInput={(e,) => {
                                        setFeaturedImage((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                    placeholder="https://..."
                                />
                            </div>

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
                                <div class="form-group">
                                    <label for="goalAmount">Goal Amount ($)</label>
                                    <input
                                        type="number"
                                        id="goalAmount"
                                        value={goalAmount()}
                                        onInput={(e,) => {
                                            setGoalAmount((e.target as HTMLInputElement).value,);
                                            markDirty();
                                        }}
                                        placeholder="10000"
                                        min="0"
                                        step="0.01"
                                    />
                                    <small class="form-help">Leave empty for an open/unlimited fund</small>
                                </div>
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

                            <div class="form-group">
                                <label for="status">Status</label>
                                <select
                                    id="status"
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
                            </div>

                            <div class="form-group">
                                <label for="startDate">Start Date</label>
                                <input
                                    type="datetime-local"
                                    id="startDate"
                                    value={startDate()}
                                    onInput={(e,) => {
                                        setStartDate((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                />
                                <small class="form-help">When the campaign starts accepting donations (optional)</small>
                            </div>
                            <div class="form-group">
                                <label for="endDate">End Date</label>
                                <input
                                    type="datetime-local"
                                    id="endDate"
                                    value={endDate()}
                                    onInput={(e,) => {
                                        setEndDate((e.target as HTMLInputElement).value,);
                                        markDirty();
                                    }}
                                />
                                <small class="form-help">When the campaign stops accepting donations (optional)</small>
                            </div>
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
