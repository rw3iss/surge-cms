import { describe, expect, it, vi, } from 'vitest';

const findForRender = vi.fn();
vi.mock('../contentBlockTemplates.js', () => ({ findForRender: (...a: unknown[]) => findForRender(...a,), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);

import { inlineTemplateHtml, resolveInlineTemplate, } from './inlineTemplates';

const component = { template: { id: 'c1', name: 'Upcoming Events', entityTypeKey: null, slots: [{ id: 'events', entityType: 'event', array: true, },], }, blocks: [], };
const productCard = { template: { id: 't1', name: 'Product Card', entityTypeKey: 'product', singularVar: 'product', mode: 'single', slots: [], }, blocks: [], };

describe('resolveInlineTemplate', () => {
    it('component: slot data + props reach the synthetic template block', async () => {
        findForRender.mockResolvedValue(component,);
        const render = vi.fn().mockResolvedValue('<x/>',);
        const ref = await resolveInlineTemplate('component', ['Upcoming Events',], { events: [{ id: 'e1', },], layout: 'column', }, render,);
        expect(ref.data,).toMatchObject({ templateId: 'c1', html: '<x/>', },);
        expect(render.mock.calls[0][0].settings,).toMatchObject({ templateId: 'c1', props: { layout: 'column', }, __slotValues: { events: [{ id: 'e1', },], }, },);
        expect(inlineTemplateHtml(ref.kind, ref.data,),).toBe('<x/>',);
    },);
    it('template: the record (positional or by its variable) becomes __records on an entity block', async () => {
        findForRender.mockResolvedValue(productCard,);
        const render = vi.fn().mockResolvedValue('<card/>',);
        await resolveInlineTemplate('template', ['Product Card',], { product: { id: 'p1', }, }, render,);
        expect(render.mock.calls[0][0],).toMatchObject({ blockType: 'entity', settings: { entity: { entityType: 'product', templateId: 't1', __records: [{ id: 'p1', },], }, }, },);
    },);
    it('errors never throw and render nothing', async () => {
        findForRender.mockResolvedValue({ error: 'no template with that name or id', },);
        const render = vi.fn();
        const ref = await resolveInlineTemplate('template', ['Nope', { id: 'x', },], {}, render,);
        expect((ref.data as { error: string; }).error,).toContain('no template',);
        expect(inlineTemplateHtml(ref.kind, ref.data,),).toBe('',);
        expect(render,).not.toHaveBeenCalled();
        expect(((await resolveInlineTemplate('component', [], {}, render,)).data as { error: string; }).error,).toContain('first argument',);
        findForRender.mockResolvedValue(productCard,);
        expect(((await resolveInlineTemplate('template', ['Product Card',], {}, render,)).data as { error: string; }).error,).toContain('no record',);
        findForRender.mockRejectedValue(new Error('db down',),);
        expect(((await resolveInlineTemplate('template', ['Product Card', { id: 'p', },], {}, render,)).data as { error: string; }).error,).toContain('could not',);
    },);
    it('stops runaway nesting', async () => {
        findForRender.mockResolvedValue(component,);
        // A render that calls itself again, like a component naming itself.
        const render = vi.fn(async (): Promise<string> => {
            const inner = await resolveInlineTemplate('component', ['Upcoming Events',], {}, render,);
            return `[${inlineTemplateHtml(inner.kind, inner.data,)}]`;
        },);
        const ref = await resolveInlineTemplate('component', ['Upcoming Events',], {}, render,);
        expect(render.mock.calls.length,).toBe(4,);
        expect(ref.data,).toMatchObject({ html: '[[[[]]]]', },);
    },);
},);
