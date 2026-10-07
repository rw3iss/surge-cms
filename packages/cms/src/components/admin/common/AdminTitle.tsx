/**
 * The document title for every admin page: `[A] {page} | {site name}`.
 *
 * Same site name as the public site (Settings → General → Site Name, via the
 * site-settings store), and the same `Page | Site` order as `buildDocumentTitle`;
 * the `[A]` prefix tells admin tabs apart from public-site tabs at a glance.
 * Children may be text and/or expressions, exactly as with `<Title>`.
 */
import { Title, } from '@solidjs/meta';
import type { ParentComponent, } from 'solid-js';
import { siteName, } from '../../../stores/siteSettings';

const AdminTitle: ParentComponent = (props,) => <Title>[A] {props.children} | {siteName()}</Title>;

export default AdminTitle;
