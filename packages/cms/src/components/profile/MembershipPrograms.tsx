/**
 * Profile → Membership → Programs: the programs ("Add its role only" levels,
 * e.g. Affiliate / Contributor) the member belongs to or applied to — beside,
 * not part of, their one membership. Cancel a pending application, or leave a
 * program (its role is removed). Both notify the team. Hidden when the member
 * has no programs, so a site without programs never shows it.
 */
import type { MembershipProgramStatus, } from '@sitesurge/types';
import { createResource, createSignal, For, Show, type Component, } from 'solid-js';
import Markdown from '../common/Markdown';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';

const day = (iso: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },) : '');

const STATUS: Record<MembershipProgramStatus['status'], { label: string; badge: string; }> = {
    member: { label: 'Member', badge: 'approved', },
    pending: { label: 'Pending review', badge: 'pending', },
    rejected: { label: 'Not approved', badge: 'rejected', },
    withdrawn: { label: 'Withdrawn', badge: 'withdrawn', },
};

function whenText(p: MembershipProgramStatus,): string {
    if (p.status === 'member') return p.decidedAt ? `Member since ${day(p.decidedAt,)}` : 'You are part of this program.';
    if (p.status === 'pending') return `Applied ${day(p.appliedAt,)} — expect a call from our team.`;
    if (p.status === 'rejected') return `Reviewed ${day(p.decidedAt,)}`;
    return p.appliedAt ? `Applied ${day(p.appliedAt,)}` : '';
}

const MembershipPrograms: Component = () => {
    const auth = useAuth();
    const [list, { refetch, },] = createResource(() => cms.payments.membershipPrograms().catch(() => [] as MembershipProgramStatus[]),);
    /** Inline "are you sure?" for one row. */
    const [asking, setAsking,] = createSignal<string | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [notice, setNotice,] = createSignal('',);

    const act = async (p: MembershipProgramStatus,) => {
        setBusy(true,);
        setError('',);
        try {
            if (p.status === 'pending' && p.applicationId) {
                await cms.payments.withdrawMembershipApplication(p.applicationId,);
                setNotice(`Your application for ${p.name} was cancelled.`,);
            } else {
                await cms.payments.leaveMembershipProgram(p.tierId,);
                setNotice(`You left ${p.name}.`,);
            }
            setAsking(null,);
            await refetch();
            void auth.refreshUser();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'That did not work — please try again.',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <Show when={list()?.length}>
            <section class="membership-programs" id="programs">
                <h3 class="membership-programs__title">Programs</h3>
                <p class="profile__muted membership-programs__lead">Programs you are part of or have applied to.</p>
                <Show when={notice()}><div class="membership__notice">{notice()}</div></Show>
                <For each={list()}>
                    {(p,) => (
                        <div class="membership-programs__row">
                            <div class="membership-programs__info">
                                <div class="membership-programs__head">
                                    <strong>{p.name}</strong>
                                    <span class={`membership__badge membership__badge--${STATUS[p.status].badge}`}>{STATUS[p.status].label}</span>
                                </div>
                                <Show when={p.description}><Markdown class="membership-programs__desc" text={p.description!} /></Show>
                                <small class="profile__muted">{whenText(p,)}</small>
                            </div>
                            <Show when={p.status === 'pending' || p.status === 'member'}>
                                <div class="membership__ask membership-programs__actions">
                                    <Show when={asking() === p.tierId}>
                                        <p>
                                            {p.status === 'pending'
                                                ? `Cancel your application for ${p.name}? Our team will be told.`
                                                : `Leave ${p.name}? Its access is removed from your account; you would need to apply again.`}
                                        </p>
                                        <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => setAsking(null,)}>Keep</button>
                                    </Show>
                                    <button
                                        type="button"
                                        class="btn btn--outline"
                                        disabled={busy()}
                                        onClick={() => (asking() === p.tierId ? void act(p,) : setAsking(p.tierId,))}
                                    >
                                        {asking() === p.tierId
                                            ? (busy() ? 'Working…' : p.status === 'pending' ? 'Yes, cancel it' : 'Yes, leave')
                                            : p.status === 'pending' ? 'Cancel application' : 'Leave program'}
                                    </button>
                                </div>
                            </Show>
                        </div>
                    )}
                </For>
                <Show when={error()}><div class="membership__error">{error()}</div></Show>
            </section>
        </Show>
    );
};

export default MembershipPrograms;
