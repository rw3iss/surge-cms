/**
 * The `/admin` route: the signed-in user's dashboard view — their role shell's
 * (`admin/shells`), else the default staff dashboard.
 */
import { Dynamic, } from 'solid-js/web';
import type { Component, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import { adminShellFor, } from '../shells';
import { dashboardFor, } from '.';

const RoleDashboard: Component = () => {
    const auth = useAuth();
    return <Dynamic component={dashboardFor(adminShellFor(auth.user,)?.dashboard,)} />;
};

export default RoleDashboard;
