/**
 * Gallery role / subscription-level gate (collections + items).
 *
 * A rule is ACTIVE when `access_enabled` AND at least one role or tier is
 * chosen — enabled with nothing chosen inherits. Effective gate of an item,
 * first match wins:
 *   1. the item's own rule, when active;
 *   2. else its collection's rule, when active;
 *   3. else the level floor (item visibility / gallery access).
 * An active rule REPLACES the floor: staff pass, or any held role (main or
 * extra) is listed, or an entitled tier is listed. Anonymous holds nothing,
 * so never passes an active rule.
 *
 * The SQL predicate (`itemGateSql`) is what every public read uses, so counts
 * and pagination stay right; `itemPasses` is the same logic in JS (tests, and
 * single-record checks). Aliases: `gi` = gallery_items, `gc` = its collection
 * (LEFT JOIN), `sp` = the item's min tier plan.
 */
import { isGalleryAccessRuleActive, type GalleryAccessRule, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import type { ViewerGrants, } from '../access/grants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** `<alias>`'s rule is active, in SQL. */
export const ruleActiveSql = (alias: string,) =>
    `(${alias}.access_enabled AND (cardinality(${alias}.access_roles) > 0 OR cardinality(${alias}.access_tier_ids) > 0))`;

/** The viewer passes `<alias>`'s rule (roles / tiers bound as params). */
export const rulePassSql = (alias: string, rolesParam: string, tiersParam: string,) =>
    `(${alias}.access_roles && ${rolesParam}::text[] OR ${alias}.access_tier_ids && ${tiersParam}::uuid[])`;

/**
 * The item gate for a site viewer: binds the viewer's roles + tiers into
 * `params` and returns a boolean SQL expression. `floorSql` is today's level
 * comparison (`<floor> <= <level>`), used when neither rule is active.
 * Staff pass everything → `TRUE`.
 */
export function itemGateSql(grants: ViewerGrants, floorSql: string, params: unknown[],): string {
    if (grants.staff) return 'TRUE';
    params.push(grants.roles,);
    const roles = `$${params.length}`;
    params.push(grants.tierIds,);
    const tiers = `$${params.length}`;
    return `(CASE WHEN ${ruleActiveSql('gi',)} THEN ${rulePassSql('gi', roles, tiers,)}`
        + ` WHEN gc.id IS NOT NULL AND ${ruleActiveSql('gc',)} THEN ${rulePassSql('gc', roles, tiers,)}`
        + ` ELSE ${floorSql} END)`;
}

/** A collection is visible when its rule is not active or the viewer passes it. */
export function collectionGateSql(grants: ViewerGrants, params: unknown[], alias = 'gc',): string {
    if (grants.staff) return 'TRUE';
    params.push(grants.roles,);
    const roles = `$${params.length}`;
    params.push(grants.tierIds,);
    const tiers = `$${params.length}`;
    return `(NOT ${ruleActiveSql(alias,)} OR ${rulePassSql(alias, roles, tiers,)})`;
}

/** JS mirror of a rule check. */
export function passesRule(rule: GalleryAccessRule, grants: ViewerGrants,): boolean {
    if (grants.staff) return true;
    return rule.roles.some((r,) => grants.roles.includes(r,),) || rule.tierIds.some((t,) => grants.tierIds.includes(t,),);
}

/** JS mirror of `itemGateSql`. `floorPasses` = today's level check for the item. */
export function itemPasses(
    item: GalleryAccessRule, collection: GalleryAccessRule | null, grants: ViewerGrants, floorPasses: boolean,
): boolean {
    if (grants.staff) return true;
    if (isGalleryAccessRuleActive(item,)) return passesRule(item, grants,);
    if (collection && isGalleryAccessRuleActive(collection,)) return passesRule(collection, grants,);
    return floorPasses;
}

export function collectionVisible(rule: GalleryAccessRule, grants: ViewerGrants,): boolean {
    return !isGalleryAccessRuleActive(rule,) || passesRule(rule, grants,);
}

/** Validate + normalise an incoming rule. */
export function cleanRule(r: Partial<GalleryAccessRule> | null | undefined,): GalleryAccessRule {
    const roles = [...new Set((r?.roles ?? []).map((x,) => String(x,).trim(),).filter(Boolean,),),];
    const bad = roles.find((x,) => !ROLE_KEY.test(x,),);
    if (bad) throw new ValidationError(`Unknown role "${bad}".`,);
    const tierIds = [...new Set((r?.tierIds ?? []).map((x,) => String(x,).trim(),).filter(Boolean,),),];
    if (tierIds.some((t,) => !UUID.test(t,),)) throw new ValidationError('Subscription levels must be tier ids.',);
    return { enabled: Boolean(r?.enabled,), roles: roles.slice(0, 50,), tierIds: tierIds.slice(0, 50,), };
}

/** DB row columns → rule. */
export function ruleFromRow(r: { access_enabled?: boolean | null; access_roles?: string[] | null; access_tier_ids?: string[] | null; },): GalleryAccessRule {
    return { enabled: Boolean(r.access_enabled,), roles: r.access_roles ?? [], tierIds: r.access_tier_ids ?? [], };
}
