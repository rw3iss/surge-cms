import { describe, expect, it, vi, } from 'vitest';
import { layoutTools, } from './layout';
import type { ToolContext, ToolDef, } from '../tool';

/** Look up a tool by name from the exported registry. */
function tool(name: string,): ToolDef {
    const t = layoutTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

/** Build a ToolContext whose cms.settings.* are mocks. */
function mockCtx() {
    const settings = {
        getSiteHeader: vi.fn(),
        siteHeader: vi.fn().mockImplementation(async (body: unknown,) => ({ message: 'ok', echoed: body, }),),
        getSiteFooter: vi.fn(),
        siteFooter: vi.fn().mockImplementation(async (body: unknown,) => ({ message: 'ok', echoed: body, }),),
    };
    const ctx = {
        cms: { settings, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, settings, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

describe('update_site_header', () => {
    it('passes the whole header object through to settings.siteHeader', async () => {
        const { ctx, settings, } = mockCtx();
        const header = {
            items: [{ id: 'i1', type: 'text', text: 'Hi', order: 0, },],
            backgroundColor: '#000',
            applyGutter: true,
        };
        await call(tool('update_site_header',), { header, }, ctx,);
        const [body,] = settings.siteHeader.mock.calls[0];
        expect(body,).toEqual(header,);
    },);
},);

describe('update_site_footer', () => {
    it('passes the whole footer object through to settings.siteFooter', async () => {
        const { ctx, settings, } = mockCtx();
        const footer = {
            enabled: true,
            rows: [
                { id: 'r1', columns: [{ id: 'c1', items: [{ id: 'i1', type: 'text', text: '©', order: 0, },], },], },
            ],
        };
        await call(tool('update_site_footer',), { footer, }, ctx,);
        const [body,] = settings.siteFooter.mock.calls[0];
        expect(body,).toEqual(footer,);
    },);
},);
