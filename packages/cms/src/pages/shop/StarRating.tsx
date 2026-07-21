import { Component, For, Show, } from 'solid-js';
import { starFills, } from './shopFormat';

interface StarRatingProps {
    /** average rating 0..5 */
    value: number;
    /** review count, shown in parens when > 0 and showCount is set */
    count?: number;
    showCount?: boolean;
}

/** Read-only 5-star display driven by an average rating. */
const StarRating: Component<StarRatingProps> = (props,) => {
    // `value` may arrive as a string (Postgres NUMERIC serializes to a string),
    // so coerce before any numeric use.
    const val = () => Number(props.value,) || 0;
    const fills = () => starFills(val(),);
    return (
        <span class="shop-stars" aria-label={`${val().toFixed(1,)} out of 5`}>
            <For each={fills()}>
                {(f,) => <span class={`shop-stars__star shop-stars__star--${f}`}>★</span>}
            </For>
            <Show when={props.showCount && (props.count ?? 0) > 0}>
                <span class="shop-stars__count">({props.count})</span>
            </Show>
        </span>
    );
};

export default StarRating;
