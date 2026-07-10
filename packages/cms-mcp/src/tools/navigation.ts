/**
 * Navigation tool. The main nav is DERIVED, not directly edited: it is computed
 * from published pages whose `showInNav` is set, ordered by `navOrder`, with the
 * `isHomepage` page as the root. Change nav membership/order by editing those
 * page fields via update_page. External / non-page links are added through the
 * site header (update_site_header). This tool only READS the computed nav.
 */
import { defineTool, type ToolContext, type ToolDef, } from '../tool';

const tools = [
    defineTool({
        name: 'get_navigation',
        description:
            'Get the computed main navigation (NavigationItem[]): the published pages that opted into the nav, in order. The nav is DERIVED — it is not edited directly. To change it: set a page\'s `showInNav`, `navOrder`, and `isHomepage` via update_page (create_page also accepts these). To add EXTERNAL links (not backed by a page), add link items to the site header via update_site_header. This tool is read-only.',
        handler: async (_args, ctx: ToolContext,) => {
            return ctx.cms.pages.navigation();
        },
    },),
];

export const navigationTools: ToolDef[] = tools as unknown as ToolDef[];
