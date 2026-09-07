/**
 * Group + group_item — the recursive layout containers.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, } from '@sitesurge/types';
import { Component, For, Show, } from 'solid-js';
import { groupColumns, groupContainerStyle, groupSlotItemStyle, groupStacksMobile, } from '../../../utils/groupStyle';
import { type TplCtx, } from './shared';
import { BlockRenderer, } from '../BlockRenderer';

export const GroupBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const children = () => (props.block.children || []) as Block[];
    const data = () => (props.block.settings || {}) as Record<string, any>;
    const containerStyle = () => groupContainerStyle(data(),);

    return (
        <div
            class="block--group"
            classList={{
                'block--group--cols': groupColumns(data(),) != null,
                'block--group--stack-mobile': groupStacksMobile(data(),),
            }}
            style={containerStyle()}
        >
            <For each={children()}>
                {(child,) => (
                    <Show when={child.isVisible !== false}>
                        {/* Thread the template context down so `{{ }}` (incl. a
                            bound entity) resolves in blocks nested inside a group
                            — previously the ctx was dropped at this recursion. */}
                        <BlockRenderer
                            block={withSlotDefaults(child, data(),)}
                            templateContext={props.ctx}
                            noDefaultPadding
                        />
                    </Show>
                )}
            </For>
        </div>
    );
};

/** Apply parent group's `itemMin/Max...` defaults to a group_item child
 *  unless the slot has its own override. Returns a shallow clone so the
 *  source block isn't mutated. */
export function withSlotDefaults(child: Block, parentData: Record<string, any>,): Block {
    if (child.type !== 'group_item') return child;
    const slot = (child.settings || {}) as Record<string, any>;
    const merged = {
        ...slot,
        minWidth: slot.minWidth ?? parentData.itemMinWidth,
        maxWidth: slot.maxWidth ?? parentData.itemMaxWidth,
        minHeight: slot.minHeight ?? parentData.itemMinHeight,
        maxHeight: slot.maxHeight ?? parentData.itemMaxHeight,
    };
    return { ...child, settings: merged as any, };
}

export const GroupItemBlock: Component<{ block: Block; ctx?: TplCtx; }> = (props,) => {
    const children = () => (props.block.children || []) as Block[];
    // NOTE: the slot's sizing (flex + width/min/max/height/align-self) lives on
    // the OUTER `.block--group_item` wrapper (BlockRenderer applies it via
    // slotStyle) — that element is the parent group's actual flex/grid item.
    // This inner div must NOT re-apply width/flex, or an explicit slot width
    // compounds (e.g. `width:30%` becomes 30% of the already-30% slot). It just
    // fills the slot so the child content spans the full column; the child owns
    // its own centering (e.g. a card's `max-width` + `margin:auto`).
    // Empty group_items render nothing on the public site (placeholder
    // picker is admin-only, in the editor BlockPreview).
    return (
        <Show when={children().length > 0}>
            <div class="block--group_item" style={{ width: '100%', height: '100%', }}>
                <For each={children()}>
                    {(child,) => (
                        <Show when={child.isVisible !== false}>
                            {/* Thread the template context to the slot's child so
                                nested `{{ }}` / entity blocks resolve. */}
                            <BlockRenderer block={child} templateContext={props.ctx} noDefaultPadding />
                        </Show>
                    )}
                </For>
            </div>
        </Show>
    );
};
