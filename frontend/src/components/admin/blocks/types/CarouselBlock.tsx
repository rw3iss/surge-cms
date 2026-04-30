import type { HeroCarouselSettings, } from '@rw/shared';
import { Component, Show, } from 'solid-js';
import HeroContentEditor from '../HeroContentEditor';

interface CarouselBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

/**
 * Carousel content block — wraps HeroContentEditor in block mode.
 * Stores all carousel items + options in block.data.
 */
const CarouselBlock: Component<CarouselBlockProps> = (props,) => {
    // Compute initial data ONCE so HeroContentEditor's onMount
    // gets a stable snapshot. The editor manages its own state
    // internally and pushes changes via onChange.
    const initial: HeroCarouselSettings = {
        items: props.data.items || [],
        options: props.data.options || {
            autoScroll: false,
            autoScrollInterval: 3000,
            repeat: true,
            customHeight: false,
            height: '50vh',
        },
    };

    return (
        <div class="block-carousel">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <Show
                        when={initial.items.length > 0}
                        fallback={
                            <span class="block-text__empty">
                                No carousel items. Click Edit to configure.
                            </span>
                        }
                    >
                        <span style={{ color: 'var(--admin-text-muted, #6b7280)', 'font-size': '0.85rem', }}>
                            Carousel — {initial.items.length} slide(s)
                        </span>
                    </Show>
                }
            >
                <HeroContentEditor
                    initialData={initial}
                    onChange={(data,) => {
                        props.onUpdate({
                            ...props.data,
                            items: data.items,
                            options: data.options,
                        },);
                    }}
                    hideHeader={true}
                />
            </Show>
        </div>
    );
};

export default CarouselBlock;
