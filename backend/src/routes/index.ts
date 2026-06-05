import { Router, } from 'express';
import { buildRouter, registerModule, } from '../api/registry';
import { apiKeysRoutes, } from './apiKeys';
import { auditRoutes, } from './audit';
import { authRoutes, } from './auth';
import { blockStylesRoutes, } from './blockStyles';
import { campaignsRoutes, } from './campaigns';
import { connectionsRoutes, } from './connections';
import { dashboardRoutes, } from './dashboard';
import { devRoutes, } from './dev';
import { fontsRoutes, } from './fonts';
import { formsRoutes, } from './forms';
import { healthRoutes, } from './health';
import mailingListsRoutes, { publicMailingListsRouter, } from './mailingLists';
import mailSendRoutes from './mailSend';
import mailTemplatesRoutes from './mailTemplates';
import mediaRoutes from './media';
import { messagesRoutes, } from './messages';
import { pagesRoutes, } from './pages';
import paymentsRoutes from './payments';
import { postsRoutes, } from './posts';
import { searchRoutes, } from './search';
import { settingsRoutes, } from './settings';
import { sitemapRoutes, } from './sitemap';
import { socialRoutes, } from './social';
import { usersRoutes, } from './users';

const router = Router();

router.use('/auth', registerModule('auth', authRoutes, { mountPath: '/api/v1/auth', },),);
router.use('/block-styles', registerModule('block-styles', blockStylesRoutes, { mountPath: '/api/v1/block-styles', },),);
router.use('/pages', registerModule('pages', pagesRoutes, { mountPath: '/api/v1/pages', },),);
router.use('/posts', registerModule('posts', postsRoutes, { mountPath: '/api/v1/posts', },),);
router.use('/campaigns', registerModule('campaigns', campaignsRoutes, { mountPath: '/api/v1/campaigns', },),);
router.use('/connections', registerModule('connections', connectionsRoutes, { mountPath: '/api/v1/connections', },),);
router.use('/payments', paymentsRoutes,);
router.use('/forms', registerModule('forms', formsRoutes, { mountPath: '/api/v1/forms', },),);
router.use('/users', registerModule('users', usersRoutes, { mountPath: '/api/v1/users', },),);
router.use('/messages', registerModule('messages', messagesRoutes, { mountPath: '/api/v1/messages', },),);
router.use('/media', mediaRoutes,);
router.use('/social', registerModule('social', socialRoutes, { mountPath: '/api/v1/social', },),);
router.use('/settings', registerModule('settings', settingsRoutes, { mountPath: '/api/v1/settings', },),);
router.use('/search', registerModule('search', searchRoutes, { mountPath: '/api/v1/search', },),);
router.use('/health', registerModule('health', healthRoutes, { mountPath: '/api/v1/health', },),);
// Legacy alias: /api/v1/sitemap/sitemap.xml + /api/v1/sitemap/admin/...
// The canonical mount (and manifest registration) lives in app.ts at the
// site root + /api/v1; this is a plain router so we don't double-register.
router.use('/sitemap', buildRouter(sitemapRoutes,),);
router.use('/api-keys', registerModule('api-keys', apiKeysRoutes, { mountPath: '/api/v1/api-keys', },),);
router.use('/audit', registerModule('audit', auditRoutes, { mountPath: '/api/v1/audit', },),);
router.use('/dashboard', registerModule('dashboard', dashboardRoutes, { mountPath: '/api/v1/dashboard', },),);
router.use('/dev', registerModule('dev', devRoutes, { mountPath: '/api/v1/dev', },),);
router.use('/fonts', registerModule('fonts', fontsRoutes, { mountPath: '/api/v1/fonts', },),);
router.use('/mailing-lists', mailingListsRoutes,);
router.use('/mail-templates', mailTemplatesRoutes,);
router.use('/mail', mailSendRoutes,);
router.use('/lists', publicMailingListsRouter,);

export default router;
