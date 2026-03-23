import { MetaProvider, } from '@solidjs/meta';
import { Route, Router, } from '@solidjs/router';
import { Component, lazy, Suspense, } from 'solid-js';
import { AppErrorBoundary, } from './components/ErrorBoundary';
import { Layout, } from './components/Layout';
import { ToastProvider, } from './components/Toast';
import { AuthProvider, } from './stores/auth';
import './styles/global.scss';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/Home'));
const LoginPage = lazy(() => import('./pages/Login'));
const JoinPage = lazy(() => import('./pages/Join'));
const DynamicPage = lazy(() => import('./pages/DynamicPage'));
const PostPage = lazy(() => import('./pages/Post'));
const PostsPage = lazy(() => import('./pages/Posts'));
const DonatePage = lazy(() => import('./pages/Donate'));
const SubscribePage = lazy(() => import('./pages/Subscribe'));
const CampaignPage = lazy(() => import('./pages/Campaign'));
const ContactPage = lazy(() => import('./pages/Contact'));
const FormPage = lazy(() => import('./pages/Form'));
const ShopPage = lazy(() => import('./pages/Shop'));
const SearchPage = lazy(() => import('./pages/Search'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));

// Admin pages
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminPages = lazy(() => import('./pages/admin/Pages'));
const AdminPageEditor = lazy(() => import('./pages/admin/PageEditor'));
const AdminPosts = lazy(() => import('./pages/admin/Posts'));
const AdminPostEditor = lazy(() => import('./pages/admin/PostEditor'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminCampaigns = lazy(() => import('./pages/admin/Campaigns'));
const AdminCampaignEditor = lazy(() => import('./pages/admin/CampaignEditor'));
const AdminForms = lazy(() => import('./pages/admin/Forms'));
const AdminFormEditor = lazy(() => import('./pages/admin/FormEditor'));
const AdminMessages = lazy(() => import('./pages/admin/Messages'));
const AdminMessageView = lazy(() => import('./pages/admin/MessageView'));
const AdminMedia = lazy(() => import('./pages/admin/Media'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminPagePreview = lazy(() => import('./pages/admin/PagePreview'));
const AdminPostPreview = lazy(() => import('./pages/admin/PostPreview'));

const PageLoading: Component = () => (
    <div class="page-loading">
        <div class="page-loading__spinner" />
    </div>
);

const App: Component = () => {
    return (
        <MetaProvider>
            <AuthProvider>
                <ToastProvider>
                    <Suspense fallback={<PageLoading />}>
                        <Router>
                            <AppErrorBoundary>
                                {/* Public routes with main layout */}
                                <Route path="/" component={Layout}>
                                    <Route path="/" component={HomePage} />
                                    <Route path="/login" component={LoginPage} />
                                    <Route path="/join" component={JoinPage} />
                                    <Route path="/posts" component={PostsPage} />
                                    <Route path="/posts/:slug" component={PostPage} />
                                    <Route path="/donate" component={DonatePage} />
                                    <Route path="/subscribe" component={SubscribePage} />
                                    <Route path="/campaigns/:slug" component={CampaignPage} />
                                    <Route path="/shop" component={ShopPage} />
                                    <Route path="/contact" component={ContactPage} />
                                    <Route path="/forms/:slug" component={FormPage} />
                                    <Route path="/search" component={SearchPage} />
                                    {/* Dynamic page route - must be last */}
                                    <Route path="/:slug" component={DynamicPage} />
                                </Route>

                                {/* Admin routes with admin layout */}
                                <Route path="/admin" component={AdminLayout}>
                                    <Route path="/" component={AdminDashboard} />
                                    <Route path="/pages" component={AdminPages} />
                                    <Route path="/pages/:id/preview" component={AdminPagePreview} />
                                    <Route path="/pages/:id" component={AdminPageEditor} />
                                    <Route path="/posts" component={AdminPosts} />
                                    <Route path="/posts/:id/preview" component={AdminPostPreview} />
                                    <Route path="/posts/new" component={AdminPostEditor} />
                                    <Route path="/posts/:id" component={AdminPostEditor} />
                                    <Route path="/users" component={AdminUsers} />
                                    <Route path="/campaigns" component={AdminCampaigns} />
                                    <Route path="/campaigns/new" component={AdminCampaignEditor} />
                                    <Route path="/campaigns/:id" component={AdminCampaignEditor} />
                                    <Route path="/forms" component={AdminForms} />
                                    <Route path="/forms/new" component={AdminFormEditor} />
                                    <Route path="/forms/:id" component={AdminFormEditor} />
                                    <Route path="/messages" component={AdminMessages} />
                                    <Route path="/messages/:id" component={AdminMessageView} />
                                    <Route path="/media" component={AdminMedia} />
                                    <Route path="/settings" component={AdminSettings} />
                                </Route>

                                {/* 404 page */}
                                <Route path="*" component={NotFoundPage} />
                            </AppErrorBoundary>
                        </Router>
                    </Suspense>
                </ToastProvider>
            </AuthProvider>
        </MetaProvider>
    );
};

export default App;
