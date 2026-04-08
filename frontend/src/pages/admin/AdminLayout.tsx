import { A, useLocation, useNavigate, } from '@solidjs/router';
import { createEffect, createSignal, ParentComponent, Show, } from 'solid-js';
import GlobalSearch from '../../components/admin/GlobalSearch';
import SiteLogo from '../../components/SiteLogo';
import { useAuth, } from '../../stores/auth';
import './AdminLayout.scss';

const AdminLayout: ParentComponent = (props,) => {
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen,] = createSignal(false,);

    createEffect(() => {
        if (!auth.isLoading && !auth.isAuthenticated) {
            navigate(`/login?return=${location.pathname}`,);
        } else if (!auth.isLoading && auth.user?.role !== 'admin' && auth.user?.role !== 'sysadmin') {
            navigate('/',);
        }
    },);

    // Close sidebar on route change (mobile)
    createEffect(() => {
        location.pathname;
        setSidebarOpen(false,);
    },);

    const isActive = (path: string,) => location.pathname === path || location.pathname.startsWith(`${path}/`,);

    const handleNavClick = () => {
        setSidebarOpen(false,);
    };

    return (
        <Show when={!auth.isLoading && (auth.user?.role === 'admin' || auth.user?.role === 'sysadmin')} fallback={<div>Loading...</div>}>
            <div class="admin-layout">
                <button
                    class={`admin-layout__hamburger ${sidebarOpen() ? 'admin-layout__hamburger--open' : ''}`}
                    onClick={() => setSidebarOpen(!sidebarOpen(),)}
                    aria-label="Toggle navigation"
                >
                    <span />
                    <span />
                    <span />
                </button>
                <Show when={sidebarOpen()}>
                    <div class="admin-layout__overlay" onClick={() => setSidebarOpen(false,)} />
                </Show>
                <aside class={`admin-layout__sidebar ${sidebarOpen() ? 'admin-layout__sidebar--open' : ''}`}>
                    <div class="admin-layout__logo">
                        <A href="/" onClick={handleNavClick}>
                            <SiteLogo size="small" />
                        </A>
                    </div>
                    <nav class="admin-layout__nav">
                        <A
                            href="/admin"
                            end
                            class={`admin-layout__nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Dashboard
                        </A>
                        <A
                            href="/admin/pages"
                            class={`admin-layout__nav-link ${isActive('/admin/pages',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Pages
                        </A>
                        <A
                            href="/admin/posts"
                            class={`admin-layout__nav-link ${isActive('/admin/posts',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Posts
                        </A>
                        <A
                            href="/admin/campaigns"
                            class={`admin-layout__nav-link ${isActive('/admin/campaigns',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Campaigns
                        </A>
                        <A
                            href="/admin/forms"
                            class={`admin-layout__nav-link ${isActive('/admin/forms',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Forms
                        </A>
                        <A
                            href="/admin/users"
                            class={`admin-layout__nav-link ${isActive('/admin/users',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Users
                        </A>
                        <A
                            href="/admin/messages"
                            class={`admin-layout__nav-link ${isActive('/admin/messages',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Messages
                        </A>
                        <A
                            href="/admin/media"
                            class={`admin-layout__nav-link ${isActive('/admin/media',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Media
                        </A>
                        <A
                            href="/admin/settings"
                            class={`admin-layout__nav-link ${isActive('/admin/settings',) ? 'active' : ''}`}
                            onClick={handleNavClick}
                        >
                            Settings
                        </A>
                        <Show when={auth.user?.role === 'sysadmin'}>
                            <A
                                href="/admin/developer"
                                class={`admin-layout__nav-link ${isActive('/admin/developer',) ? 'active' : ''}`}
                                onClick={handleNavClick}
                            >
                                Developer
                            </A>
                        </Show>
                    </nav>
                    <div class="admin-layout__user">
                        <span>{auth.user?.displayName}</span>
                        <button onClick={() => auth.logout()}>Logout</button>
                    </div>
                </aside>
                <main class="admin-layout__main">
                    {props.children}
                </main>
                <GlobalSearch />
            </div>
        </Show>
    );
};

export default AdminLayout;
