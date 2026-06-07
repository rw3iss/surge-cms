/**
 * Internal CMS SDK.
 *
 * Single import surface for code that wants to interact with the CMS
 * without going through HTTP. Routes, scripts, tests, and future
 * plugins all use the same modules — keeps business logic in exactly
 * one place and makes capability discovery uniform.
 *
 * Each capability is exposed as a sub-module under the `cms` object:
 *
 *   import { cms } from './sdk';
 *
 *   const page = await cms.pages.create({...}, ctx);
 *   const branding = await cms.settings.get<SiteBranding>('site_branding');
 *
 * Conventions documented in
 * `docs/superpowers/specs/2026-04-28-cms-sdk-design.md`. Capability
 * modules satisfy the `Service<T>` contract from `./types` where
 * applicable, and consistently take an `AuditContext` for writes
 * so audit logging works the same regardless of caller (HTTP, script,
 * plugin).
 */
import * as blockStyles from './blockStyles';
import * as campaigns from './campaigns';
import * as fonts from './fonts';
import * as forms from './forms';
import * as messages from './messages';
import * as pages from './pages';
import * as posts from './posts';
import * as settings from './settings';
import * as swatches from './swatches';
import * as users from './users';

export const cms = {
    blockStyles,
    campaigns,
    fonts,
    forms,
    messages,
    pages,
    posts,
    settings,
    swatches,
    users,
};

export type Cms = typeof cms;

export type { AuditContext, ListResult, PaginationOpts, Service, } from './types';
export { auditFromRequest, } from './types';
