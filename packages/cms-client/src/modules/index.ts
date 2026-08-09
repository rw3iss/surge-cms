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
import { UtilsModule, } from './utils';
import { AuditModule, } from './audit';
import { DashboardModule, } from './dashboard';
import { AuthModule, } from './auth';
import { ApiKeysModule, } from './apiKeys';
import { ConnectionsModule, } from './connections';
import { BlockStylesModule, } from './blockStyles';
import { FontsModule, } from './fonts';
import { DevModule, } from './dev';
import { HealthModule, } from './health';
import { SetupModule, } from './setup';
import { MailingListsModule, } from './mailingLists';
import { MailTemplatesModule, } from './mailTemplates';
import { MailSendModule, } from './mailSend';
import { PaymentsModule, } from './payments';
import { SettingsModule, } from './settings';
import { ShopModule, } from './shop';
import { PluginsModule, } from './plugins';
import { FeedModule, } from './feed';
import { SitemapModule, } from './sitemap';
import { ContentBlockTemplatesModule, EntitiesModule, EntityTypesModule, } from './entities';

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
    utils: UtilsModule;
    audit: AuditModule;
    dashboard: DashboardModule;
    auth: AuthModule;
    apiKeys: ApiKeysModule;
    connections: ConnectionsModule;
    blockStyles: BlockStylesModule;
    fonts: FontsModule;
    dev: DevModule;
    health: HealthModule;
    setup: SetupModule;
    mailingLists: MailingListsModule;
    mailTemplates: MailTemplatesModule;
    mailSend: MailSendModule;
    payments: PaymentsModule;
    settings: SettingsModule;
    shop: ShopModule;
    plugins: PluginsModule;
    feed: FeedModule;
    sitemap: SitemapModule;
    entities: EntitiesModule;
    entityTypes: EntityTypesModule;
    contentBlockTemplates: ContentBlockTemplatesModule;
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
    c.utils = new UtilsModule(core,);
    c.audit = new AuditModule(core,);
    c.dashboard = new DashboardModule(core,);
    // `core.auth` is typed AuthRuntime; AuthModule implements it and wraps
    // the underlying AuthManager, so replacing the public `auth` handle with
    // the module type-checks directly (no cast). Any core call to a member
    // AuthModule failed to forward would now be a compile error.
    c.auth = new AuthModule(core,);
    c.apiKeys = new ApiKeysModule(core,);
    c.connections = new ConnectionsModule(core,);
    c.blockStyles = new BlockStylesModule(core,);
    c.fonts = new FontsModule(core,);
    c.dev = new DevModule(core,);
    c.health = new HealthModule(core,);
    c.setup = new SetupModule(core,);
    c.mailingLists = new MailingListsModule(core,);
    c.mailTemplates = new MailTemplatesModule(core,);
    c.mailSend = new MailSendModule(core,);
    c.payments = new PaymentsModule(core,);
    c.settings = new SettingsModule(core,);
    c.shop = new ShopModule(core,);
    c.plugins = new PluginsModule(core,);
    c.feed = new FeedModule(core,);
    c.sitemap = new SitemapModule(core,);
    c.entities = new EntitiesModule(core,);
    c.entityTypes = new EntityTypesModule(core,);
    c.contentBlockTemplates = new ContentBlockTemplatesModule(core,);
    return c as CmsClientCore & CmsModules;
}

export { ROUTE_COVERAGE, INTENTIONALLY_UNEXPOSED, } from './coverage';

export {
    PostsModule, PagesModule, CampaignsModule, FormsModule, MediaModule,
    UsersModule, MessagesModule, SocialModule, SearchModule, UtilsModule, AuditModule, DashboardModule,
    AuthModule, ApiKeysModule, ConnectionsModule, BlockStylesModule, FontsModule,
    DevModule, HealthModule, SetupModule,
    MailingListsModule, MailTemplatesModule, MailSendModule, PaymentsModule,
    SettingsModule, ShopModule, PluginsModule, FeedModule, SitemapModule,
    EntitiesModule, EntityTypesModule, ContentBlockTemplatesModule,
};
