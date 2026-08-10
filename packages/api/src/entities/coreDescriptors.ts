/**
 * Core entity type descriptors — `post`/`page`/`user`/`campaign`/`form` defined
 * as `internal` entity types that ADOPT their existing tables (Milestone 1: no
 * data migration; the bespoke modules keep serving CRUD, and these descriptors
 * make the types visible to the Entities UI + the template registry). Phase 8
 * flips their CRUD onto the generic repo.
 *
 * Fields are derived from the shared `{{ }}` reference catalog (`ENTITIES`),
 * mapped to `EntityFieldDef` with `core: true`. Since the tables already exist,
 * the table generator is NOT run for these — `scaffoldCoreType` only upserts the
 * definition rows.
 */
import type { PoolClient, } from 'pg';
import {
    type EntityDoc,
    type EntityFieldDef,
    type EntityFieldType,
    ENTITIES,
    type EntityTypeDef,
} from '@sitesurge/types';
import { query, } from '../db';
import { FEATURE_REGISTRY, type FeatureKey, } from '../features/registry';
import * as entityTypesRepo from '../repositories/entityTypes.repo';
import * as entityManager from './entityManager';
import { logger, } from '../utils/logger';

/** Standard/managed columns that are NOT authored as schema fields. */
const MANAGED_KEYS = new Set(['id', 'createdAt', 'updatedAt',]);

/** Map a docs type string (e.g. `"'draft'|'published'"`, `string[]`) to a
 *  field type. Best-effort — core fields describe existing columns; exactness
 *  matters only for the generic writer (Phase 8), not for reads/reference. */
function mapDocType(t: string,): EntityFieldType {
    const s = t.toLowerCase();
    if (s.includes('[]',)) return 'json';
    if (s.startsWith('number',)) return 'number';
    if (s.includes('boolean',)) return 'boolean';
    if (s.startsWith('date',)) return 'datetime';
    if (s.includes("'",)) return 'enum';
    return 'text';
}

function coreFieldsFromDoc(doc: EntityDoc,): EntityFieldDef[] {
    return doc.fields
        .filter((f,) => !MANAGED_KEYS.has(f.name,))
        .map((f, i,) => ({
            id: `core:${doc.kind}:${f.name}`,
            key: f.name,
            label: f.name,
            type: f.note === 'HTML body' ? 'richtext' : mapDocType(f.type,),
            core: true,
            required: false,
            unique: f.name === 'slug',
            indexed: false,
            searchable: ['title', 'name',].includes(f.name,),
            position: i,
            options: f.type.includes("'",)
                ? { values: f.type.split('|',).map((v,) => v.replace(/['"()]/g, '',).trim(),).filter(Boolean,), }
                : undefined,
        }),);
}

function docByKind(kind: string,): EntityDoc | undefined {
    return ENTITIES.find((e,) => e.kind === kind,);
}

/** Build the core descriptor for one kind, or null when its reference doc is
 *  missing. `id`/timestamps are placeholders (the repo assigns real ones). */
function coreType(opts: {
    key: string; label: string; labelPlural: string; singularVar: string; pluralVar: string;
    ownerFeature?: FeatureKey; tableName: string; hasStatus: boolean;
    detailPrefix?: string; adminListRoute: string; adminEditRoute?: string;
},): EntityTypeDef | null {
    const doc = docByKind(opts.key,);
    if (!doc) return null;
    return {
        id: '', key: opts.key, label: opts.label, labelPlural: opts.labelPlural,
        singularVar: opts.singularVar, pluralVar: opts.pluralVar, description: doc.desc,
        origin: 'core', internal: true, ownerFeature: opts.ownerFeature,
        tableName: opts.tableName, hasSlug: true, hasStatus: opts.hasStatus,
        searchable: opts.key === 'post' || opts.key === 'page', revisioned: opts.key === 'post' || opts.key === 'page',
        routing: {
            detailEnabled: Boolean(opts.detailPrefix,), detailPrefix: opts.detailPrefix ?? '',
            indexEnabled: Boolean(opts.detailPrefix,), indexPrefix: opts.detailPrefix ?? '',
        },
        caching: { indexEnabled: true, indexTtlSeconds: 60, recordEnabled: true, recordTtlSeconds: 60, },
        adminListRoute: opts.adminListRoute, adminEditRoute: opts.adminEditRoute,
        fields: coreFieldsFromDoc(doc,), createdAt: '', updatedAt: '',
    };
}

/** Build one product field def (core, describing a shop_products column). */
function pf(key: string, type: EntityFieldType, extra: Partial<EntityFieldDef> = {},): EntityFieldDef {
    return {
        id: `core:product:${key}`, key, label: key, type, core: true,
        required: false, unique: false, indexed: false, searchable: false, position: 0, ...extra,
    };
}

/** The `product` entity type — adopts `shop_products` (owned by the shop
 *  feature). Media + tags are enriched by the Shop data provider (not columns),
 *  so they're not declared fields but appear on every record. */
function productDescriptor(): EntityTypeDef {
    const fields: EntityFieldDef[] = [
        pf('title', 'text', { required: true, searchable: true, indexed: true, position: 0, },),
        pf('description', 'richtext', { position: 1, },),
        pf('type', 'enum', { options: { values: ['physical', 'digital',], }, position: 2, },),
        pf('meta_title', 'text', { position: 3, },),
        pf('meta_description', 'longtext', { position: 4, },),
        pf('shipping_type', 'text', { position: 5, },),
        pf('use_default_shipping', 'boolean', { position: 6, },),
        pf('shipping_cents', 'integer', { position: 7, },),
        pf('rating_avg', 'number', { position: 8, },),
        pf('rating_count', 'integer', { position: 9, },),
    ];
    return {
        id: '', key: 'product', label: 'Product', labelPlural: 'Products',
        singularVar: 'product', pluralVar: 'products',
        description: 'A shop product (managed by the Shop feature). Records include `media` (array) + `tags` (array).',
        origin: 'core', internal: true, ownerFeature: 'shop', tableName: 'shop_products',
        hasSlug: true, hasStatus: true, searchable: false, revisioned: false,
        routing: { detailEnabled: true, detailPrefix: '/shop', indexEnabled: true, indexPrefix: '/shop', },
        caching: { indexEnabled: true, indexTtlSeconds: 60, recordEnabled: true, recordTtlSeconds: 60, },
        adminListRoute: '/admin/shop/products', adminEditRoute: '/admin/shop/products/:id',
        fields, createdAt: '', updatedAt: '',
    };
}

/** All core descriptors (built fresh each call). */
export function coreDescriptors(): EntityTypeDef[] {
    return [
        coreType({ key: 'page', label: 'Page', labelPlural: 'Pages', singularVar: 'page', pluralVar: 'pages',
            tableName: 'pages', hasStatus: true, adminListRoute: '/admin/pages', adminEditRoute: '/admin/pages/:id', }),
        coreType({ key: 'post', label: 'Post', labelPlural: 'Posts', singularVar: 'post', pluralVar: 'posts',
            ownerFeature: 'posts', tableName: 'posts', hasStatus: true, detailPrefix: '/posts',
            adminListRoute: '/admin/posts', adminEditRoute: '/admin/posts/:id', }),
        coreType({ key: 'campaign', label: 'Campaign', labelPlural: 'Campaigns', singularVar: 'campaign', pluralVar: 'campaigns',
            ownerFeature: 'campaigns', tableName: 'campaigns', hasStatus: true, detailPrefix: '/donate',
            adminListRoute: '/admin/campaigns', adminEditRoute: '/admin/campaigns/:id', }),
        coreType({ key: 'form', label: 'Form', labelPlural: 'Forms', singularVar: 'form', pluralVar: 'forms',
            ownerFeature: 'forms', tableName: 'forms', hasStatus: true, detailPrefix: '/forms',
            adminListRoute: '/admin/forms', adminEditRoute: '/admin/forms/:id', }),
        coreType({ key: 'user', label: 'User', labelPlural: 'Users', singularVar: 'user', pluralVar: 'users',
            ownerFeature: 'users', tableName: 'users', hasStatus: false,
            adminListRoute: '/admin/users', adminEditRoute: '/admin/users', }),
        productDescriptor(),
    ].filter((d,): d is EntityTypeDef => d !== null);
}

/** Upsert a core type + its fields (no table generation — table exists). */
export async function scaffoldCoreType(def: EntityTypeDef, client?: PoolClient,): Promise<void> {
    const c = client as never;
    const id = await entityTypesRepo.upsertType(def, c,);
    for (const f of def.fields) await entityTypesRepo.upsertField(id, f, c,);
}

async function isFeatureEnabled(feature: string,): Promise<boolean> {
    const cfg = FEATURE_REGISTRY[feature as FeatureKey];
    try {
        const r = await query<{ value: unknown; }>(
            `SELECT value FROM site_settings WHERE key = $1`, [`${feature}_enabled`,],
        );
        if (r.rows.length === 0) return cfg?.defaultEnabled ?? false;
        const v = r.rows[0].value;
        return v === true || v === 'true'
            || (typeof v === 'object' && v !== null && (v as { value?: unknown; }).value === true);
    } catch {
        return cfg?.defaultEnabled ?? false;
    }
}

/**
 * Idempotently register the core entity types whose owning feature is enabled
 * (pages have no feature → always). Called at boot after migrations; reloads
 * the EntityManager afterward. Safe to re-run.
 */
export async function seedCoreEntityTypes(): Promise<void> {
    let seeded = 0;
    for (const def of coreDescriptors()) {
        if (def.ownerFeature && !(await isFeatureEnabled(def.ownerFeature,))) continue;
        await scaffoldCoreType(def,);
        seeded++;
    }
    if (entityManager.isLoaded()) await entityManager.invalidate();
    logger.info(`Seeded ${seeded} core entity type(s).`,);
}
