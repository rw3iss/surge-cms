import { Component, } from 'solid-js';
import ConnectionsPanel from '../../../components/admin/social/ConnectionsPanel';

/**
 * Configuration tab — provider connections + per-provider utilities. The
 * connections UI was relocated here from Settings → Connections (M3).
 */
const SocialConfigurationPanel: Component = () => {
    return (
        <section class="social-configuration">
            <ConnectionsPanel />
        </section>
    );
};

export default SocialConfigurationPanel;
