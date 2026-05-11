import { BlockEmailRenderer, } from './index';

export const renderSpacer: BlockEmailRenderer = (node,) => {
    const raw = Number(node.settings.height ?? 24,);
    const h = Number.isFinite(raw,) && raw > 0 ? Math.min(400, Math.max(1, raw,),) : 24;
    return `<tr><td style="line-height:${h}px;height:${h}px;font-size:1px">&nbsp;</td></tr>`;
};
