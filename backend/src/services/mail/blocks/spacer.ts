import { BlockEmailRenderer, } from './index';

export const renderSpacer: BlockEmailRenderer = (node,) => {
    const raw = Number(node.settings.height ?? 24,);
    const h = Number.isFinite(raw,) && raw > 0 ? Math.min(400, Math.max(1, raw,),) : 24;
    // Spacer's height drives the cell sizing — block.style padding is
    // intentionally overridden to 0 for spacers since the height
    // setting is the whole point of the block.
    return {
        content: '&nbsp;',
        cellStyle: {
            height: `${h}px`,
            'line-height': `${h}px`,
            'font-size': '1px',
            padding: '0',
        },
    };
};
