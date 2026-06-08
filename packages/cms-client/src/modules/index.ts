// packages/cms-client/src/modules/index.ts (grows per batch)
import type { CmsClientCore, } from '../core/client';
import { PostsModule, } from './posts';
import { PagesModule, } from './pages';
import { CampaignsModule, } from './campaigns';
import { FormsModule, } from './forms';
import { MediaModule, } from './media';
import { UsersModule, } from './users';
import { MessagesModule, } from './messages';
import { SocialModule, } from './social';
import { SearchModule, } from './search';
import { AuditModule, } from './audit';
import { DashboardModule, } from './dashboard';

export interface CmsModules {
    posts: PostsModule;
    pages: PagesModule;
    campaigns: CampaignsModule;
    forms: FormsModule;
    media: MediaModule;
    users: UsersModule;
    messages: MessagesModule;
    social: SocialModule;
    search: SearchModule;
    audit: AuditModule;
    dashboard: DashboardModule;
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
    c.users = new UsersModule(core,);
    c.messages = new MessagesModule(core,);
    c.social = new SocialModule(core,);
    c.search = new SearchModule(core,);
    c.audit = new AuditModule(core,);
    c.dashboard = new DashboardModule(core,);
    return c as CmsClientCore & CmsModules;
}

export {
    PostsModule, PagesModule, CampaignsModule, FormsModule, MediaModule,
    UsersModule, MessagesModule, SocialModule, SearchModule, AuditModule, DashboardModule,
};
