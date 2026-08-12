import Spinner from '../../ui/Spinner';

interface LoadingStateProps {
    /** Text shown beside the spinner (default "Loading…"). */
    label?: string;
}

/**
 * Consistent loading affordance — a real spinner + label inside `.empty-state`,
 * replacing the hand-written `<div class="empty-state">Loading…</div>` text
 * fallbacks (which showed no spinner) used across admin list pages.
 */
export default function LoadingState(props: LoadingStateProps,) {
    return (
        <div class="empty-state empty-state--loading u-flex-row u-items-baseline u-gap-sm">
            <Spinner label={props.label ?? 'Loading…'} />
        </div>
    );
}
