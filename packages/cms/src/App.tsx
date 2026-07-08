import { MetaProvider, } from '@solidjs/meta';
import { Route, Router, } from '@solidjs/router';
import { Component, lazy, Suspense, } from 'solid-js';
import { AppErrorBoundary, } from './components/common/ErrorBoundary';
import { Layout, } from './components/layout';
import { ToastProvider, } from './components/common/toast';
import { AuthProvider, } from './stores/auth';
import './styles/global.scss';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/Home'));
const LoginPage = lazy(() => import('./pages/Login'));
const JoinPage = lazy(() => import('./pages/Join'));
const DynamicPage = lazy(() => import('./pages/DynamicPage'));
const PostPage = lazy(() => import('./pages/Post'));
const PostsPage = lazy(() => import('./pages/Posts'));
// DonatePage removed — /donate now uses DynamicPage via the /:slug route
const SubscribePage = lazy(() => import('./pages/Subscribe'));
const CampaignPage = lazy(() => import('./pages/Campaign'));
const ContactPage = lazy(() => import('./pages/Contact'));
const FormPage = lazy(() => import('./pages/Form'));
const ShopIndexPage = lazy(() => import('./pages/shop/ShopIndex'));
const ShopProductPage = lazy(() => import('./pages/shop/ShopProduct'));
const ShopCollectionPage = lazy(() => import('./pages/shop/ShopCollection'));
const ShopCategoryPage = lazy(() => import('./pages/shop/ShopCategory'));
const ShopCartPage = lazy(() => import('./pages/shop/ShopCart'));
const ShopCheckoutPage = lazy(() => import('./pages/shop/ShopCheckout'));
const ShopOrderConfirmationPage = lazy(() => import('./pages/shop/ShopOrderConfirmation'));
const SearchPage = lazy(() => import('./pages/Search'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));
const SetupPage = lazy(() => import('./pages/setup/Setup'));

// Admin pages
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminPages = lazy(() => import('./pages/admin/Pages'));
const AdminPageEditor = lazy(() => import('./pages/admin/PageEditor'));
const AdminPosts = lazy(() => import('./pages/admin/Posts'));
const AdminPostEditor = lazy(() => import('./pages/admin/PostEditor'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminUserDetail = lazy(() => import('./pages/admin/UserDetail'));
const AdminCampaigns = lazy(() => import('./pages/admin/Campaigns'));
const AdminCampaignEditor = lazy(() => import('./pages/admin/CampaignEditor'));
const AdminForms = lazy(() => import('./pages/admin/Forms'));
const AdminFormEditor = lazy(() => import('./pages/admin/FormEditor'));
const AdminFormSubmissions = lazy(() => import('./pages/admin/FormSubmissions'));
const AdminMessages = lazy(() => import('./pages/admin/Messages'));
const AdminMessageView = lazy(() => import('./pages/admin/MessageView'));
const AdminMailingLists = lazy(() => import('./pages/admin/MailingLists'));
const AdminMailingListEdit = lazy(() => import('./pages/admin/MailingListEdit'));
const AdminMailTemplateEdit = lazy(() => import('./pages/admin/MailTemplateEdit'));
const AdminMailSend = lazy(() => import('./pages/admin/MailSend'));
const AdminMailJob = lazy(() => import('./pages/admin/MailJob'));
const AdminMedia = lazy(() => import('./pages/admin/Media'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminShopDashboard = lazy(() => import('./pages/admin/shop/ShopDashboard'));
const AdminShopProducts = lazy(() => import('./pages/admin/shop/ShopProducts'));
const AdminShopProductEditor = lazy(() => import('./pages/admin/shop/ShopProductEditor'));
const AdminShopCategories = lazy(() => import('./pages/admin/shop/ShopCategories'));
const AdminShopCollections = lazy(() => import('./pages/admin/shop/ShopCollections'));
const AdminShopOrders = lazy(() => import('./pages/admin/shop/ShopOrders'));
const AdminShopOrderDetail = lazy(() => import('./pages/admin/shop/ShopOrderDetail'));
const AdminShopReviews = lazy(() => import('./pages/admin/shop/ShopReviews'));
const AdminShopSettings = lazy(() => import('./pages/admin/shop/ShopSettings'));
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
                                    <Route path="/donate" component={DynamicPage} />
                                    <Route path="/subscribe" component={SubscribePage} />
                                    <Route path="/campaigns/:slug" component={CampaignPage} />
                                    <Route path="/shop" component={ShopIndexPage} />
                                    <Route path="/shop/cart" component={ShopCartPage} />
                                    <Route path="/shop/checkout" component={ShopCheckoutPage} />
                                    <Route path="/shop/collections/:slug" component={ShopCollectionPage} />
                                    <Route path="/shop/categories/:slug" component={ShopCategoryPage} />
                                    <Route path="/shop/orders/:number" component={ShopOrderConfirmationPage} />
                                    <Route path="/shop/:slug" component={ShopProductPage} />
                                    <Route path="/contact" component={ContactPage} />
                                    <Route path="/forms/:slug" component={FormPage} />
                                    <Route path="/search" component={SearchPage} />
                                    {/* Dynamic page route - must be last among
                                        single-segment paths. */}
                                    <Route path="/:slug" component={DynamicPage} />
                                    {/* Catch-all 404 lives INSIDE Layout so the
                                        public Header/Footer + theme tokens
                                        (--site-primary, etc.) apply. Multi-
                                        segment paths like /pages/foo land here
                                        instead of the un-themed root catch-all. */}
                                    <Route path="*" component={NotFoundPage} />
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
                                    <Route path="/users/:id" component={AdminUserDetail} />
                                    <Route path="/campaigns" component={AdminCampaigns} />
                                    <Route path="/campaigns/new" component={AdminCampaignEditor} />
                                    <Route path="/campaigns/:id" component={AdminCampaignEditor} />
                                    <Route path="/forms" component={AdminForms} />
                                    <Route path="/forms/new" component={AdminFormEditor} />
                                    <Route path="/forms/:id/submissions" component={AdminFormSubmissions} />
                                    <Route path="/forms/:id" component={AdminFormEditor} />
                                    <Route path="/messages" component={AdminMessages} />
                                    <Route path="/messages/:id" component={AdminMessageView} />
                                    <Route path="/mailing-lists" component={AdminMailingLists} />
                                    <Route path="/mailing-lists/:id" component={AdminMailingListEdit} />
                                    <Route path="/mail-templates/:id" component={AdminMailTemplateEdit} />
                                    <Route path="/mail/send" component={AdminMailSend} />
                                    <Route path="/mail/jobs/:id" component={AdminMailJob} />
                                    <Route path="/media" component={AdminMedia} />
                                    <Route path="/shop" component={AdminShopDashboard} />
                                    <Route path="/shop/products" component={AdminShopProducts} />
                                    <Route path="/shop/products/new" component={AdminShopProductEditor} />
                                    <Route path="/shop/products/:id" component={AdminShopProductEditor} />
                                    <Route path="/shop/categories" component={AdminShopCategories} />
                                    <Route path="/shop/collections" component={AdminShopCollections} />
                                    <Route path="/shop/orders" component={AdminShopOrders} />
                                    <Route path="/shop/orders/:id" component={AdminShopOrderDetail} />
                                    <Route path="/shop/reviews" component={AdminShopReviews} />
                                    <Route path="/shop/settings" component={AdminShopSettings} />
                                    <Route path="/settings" component={AdminSettings} />
                                </Route>

                                {/* Setup wizard — outside the main Layout so it can render its own chrome. */}
                                <Route path="/setup" component={SetupPage} />
                            </AppErrorBoundary>
                        </Router>
                    </Suspense>
                </ToastProvider>
            </AuthProvider>
        </MetaProvider>
    );
};

export default App;
