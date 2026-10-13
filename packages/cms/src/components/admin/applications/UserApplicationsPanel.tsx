/**
 * User detail → "Membership application": this member's applications for
 * levels that require approval, newest first, each with Review (pending) or
 * View. Renders nothing when the member never applied.
 */
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import type { MembershipApplication, } from '@sitesurge/types';
import { formatDateTime, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { approvalBadge, } from './applicationStatus';
import ReviewApplicationModal from './ReviewApplicationModal';
import './applications.scss';

export interface UserApplicationsPanelProps {
    userId: string;
    /** After an approve / reject (the membership may have changed). */
    onChanged?: () => void;
}

const UserApplicationsPanel: Component<UserApplicationsPanelProps> = (props,) => {
    const [apps, { refetch, },] = createResource(
        () => props.userId,
        (userId,) => cms.membershipApplications.list({ userId, limit: 50, },).then((r,) => r.data,).catch(() => [] as MembershipApplication[]),
    );
    const [open, setOpen,] = createSignal<string | null>(null,);

    return (
        <Show when={(apps() ?? []).length > 0}>
            <div class="user-detail__panel user-applications">
                <h2 class="user-detail__panel-title">Membership application</h2>
                <ul class="user-applications__list">
                    <For each={apps()}>
                        {(a,) => (
                            <li class="user-applications__item">
                                <strong>{a.tierName}</strong>
                                <Show when={approvalBadge(a.status,)}>{(b,) => <span class={b().cls}>{b().label}</span>}</Show>
                                <span class="user-applications__meta">
                                    Applied {formatDateTime(a.createdAt,)}
                                    <Show when={a.decidedAt}>
                                        {' '}· {a.status} {a.decidedBy ? `by ${a.decidedBy} ` : ''}on {formatDateTime(a.decidedAt!,)}
                                    </Show>
                                    <Show when={a.error && a.status === 'pending'}> · last approval failed</Show>
                                </span>
                                <button
                                    type="button"
                                    class={`ui-button ui-button--sm ${a.status === 'pending' ? 'ui-button--primary' : 'ui-button--secondary'}`}
                                    onClick={() => setOpen(a.id,)}
                                >
                                    {a.status === 'pending' ? 'Review' : 'View'}
                                </button>
                            </li>
                        )}
                    </For>
                </ul>
            </div>
            <Show when={open()}>
                <ReviewApplicationModal
                    applicationId={open()!}
                    onClose={() => setOpen(null,)}
                    onDecided={() => { setOpen(null,); void refetch(); props.onChanged?.(); }}
                />
            </Show>
        </Show>
    );
};

export default UserApplicationsPanel;
