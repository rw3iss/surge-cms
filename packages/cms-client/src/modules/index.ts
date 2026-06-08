// packages/cms-client/src/modules/index.ts (grows per batch)
import type { CmsClientCore, } from '../core/client';
import { PostsModule, } from './posts';
import { PagesModule, } from './pages';
import { CampaignsModule, } from './campaigns';
import { FormsModule, } from './forms';
import { MediaModule, } from './media';

export interface CmsModules {
    posts: PostsModule;
    pages: PagesModule;
    campaigns: CampaignsModule;
    forms: FormsModule;
    media: MediaModule;
}

export function assembleModules(core: CmsClientCore,): CmsClientCore & CmsModules {
    // Cast localized to assembly: each namespace is attached to the core
    // instance, which is then surfaced as `CmsClientCore & CmsModules`.
    const c = core as CmsClientCore & Partial<CmsModules>;
    c.posts = new PostsModule(core,);
    c.pages = new PagesModule(core,);
    c.campaigns = new CampaignsModule(core,);
    c.forms = new FormsModule(core,);
    c.media = new MediaModule(core,);
    return c as CmsClientCore & CmsModules;
}

export { PostsModule, PagesModule, CampaignsModule, FormsModule, MediaModule, };
