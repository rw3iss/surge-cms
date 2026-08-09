/**
 * Machine-readable entity field catalog for the `{{ }}` reference (the
 * in-editor panel + `/admin/help/variables-and-functions`). Promoted into
 * `@sitesurge/types` so the SERVER (ssr/mail runtimes, core descriptors) can
 * read the same catalog the cms editor shows — previously it was cms-local.
 *
 * These entries describe the CORE entities' public fields. In a later phase
 * this catalog is GENERATED from the EntityTypeRegistry (one source of truth);
 * for now it is hand-authored and also seeds the core entity descriptors.
 */

/** One documented field of an entity (docs shape — distinct from the fuller
 *  `EntityFieldDef` schema type used by the generic storage engine). */
export interface EntityField {
    name: string;
    type: string;
    note?: string;
}

/** One documented entity kind + its fields. */
export interface EntityDoc {
    name: string;
    kind: string;
    desc: string;
    fields: EntityField[];
}

export const ENTITIES: EntityDoc[] = [
    {
        name: 'Post', kind: 'post', desc: 'A blog/news post. `post` is auto-available on a post page.',
        fields: [
            { name: 'id', type: 'string', }, { name: 'slug', type: 'string', }, { name: 'title', type: 'string', },
            { name: 'excerpt', type: 'string?', }, { name: 'content', type: 'string', note: 'HTML body', },
            { name: 'featuredImage', type: 'string?', }, { name: 'author', type: 'string', }, { name: 'authorId', type: 'string', },
            { name: 'status', type: "'draft'|'published'|'archived'", }, { name: 'tags', type: 'string[]', },
            { name: 'categories', type: 'string[]', }, { name: 'metaTitle', type: 'string?', }, { name: 'metaDescription', type: 'string?', },
            { name: 'publishedAt', type: 'date?', }, { name: 'bannerLayout', type: "'hero'|'standalone'|'thumbnail'", },
            { name: 'createdAt', type: 'date', }, { name: 'updatedAt', type: 'date', },
        ],
    },
    {
        name: 'Campaign', kind: 'campaign', desc: 'A fundraising campaign. `campaign` is auto-available on a campaign page.',
        fields: [
            { name: 'id', type: 'string', }, { name: 'title', type: 'string', }, { name: 'slug', type: 'string', },
            { name: 'description', type: 'string', note: 'HTML body', }, { name: 'shortDescription', type: 'string?', },
            { name: 'featuredImage', type: 'string?', }, { name: 'goalAmountCents', type: 'number', },
            { name: 'currentAmountCents', type: 'number', }, { name: 'showRaisedAmount', type: 'boolean', },
            { name: 'status', type: "'draft'|'active'|'completed'|'cancelled'", }, { name: 'donorCount', type: 'number', },
            { name: 'startDate', type: 'date?', }, { name: 'endDate', type: 'date?', }, { name: 'isPublished', type: 'boolean', },
            { name: 'donationProvider', type: "'internal'|'givebutter'", }, { name: 'createdAt', type: 'date', }, { name: 'updatedAt', type: 'date', },
        ],
    },
    {
        name: 'Form', kind: 'form', desc: 'A form / survey / poll. Rendering the whole form is interactive.',
        fields: [
            { name: 'id', type: 'string', }, { name: 'title', type: 'string', }, { name: 'slug', type: 'string', },
            { name: 'description', type: 'string?', }, { name: 'status', type: 'FormStatus', }, { name: 'showResults', type: 'boolean', },
            { name: 'allowMultipleSubmissions', type: 'boolean', }, { name: 'requiresAuth', type: 'boolean', },
            { name: 'successMessage', type: 'string?', }, { name: 'questions', type: 'FormQuestion[]', },
            { name: 'submissionCount', type: 'number', }, { name: 'createdAt', type: 'date', }, { name: 'updatedAt', type: 'date', },
        ],
    },
    {
        name: 'FormQuestion', kind: '(sub of Form)', desc: 'A single question within a form (`form.questions`).',
        fields: [
            { name: 'id', type: 'string', }, { name: 'formId', type: 'string', }, { name: 'type', type: 'QuestionType', },
            { name: 'question', type: 'string', }, { name: 'description', type: 'string?', }, { name: 'options', type: 'string[]?', },
            { name: 'isRequired', type: 'boolean', }, { name: 'order', type: 'number', },
        ],
    },
    {
        name: 'Media', kind: 'media', desc: 'An uploaded media asset (image/video/document).',
        fields: [
            { name: 'id', type: 'string', }, { name: 'filename', type: 'string', }, { name: 'originalName', type: 'string', },
            { name: 'mimeType', type: 'string', }, { name: 'size', type: 'number', }, { name: 'url', type: 'string', },
            { name: 'thumbnailUrl', type: 'string?', }, { name: 'alt', type: 'string?', }, { name: 'caption', type: 'string?', },
            { name: 'createdAt', type: 'date', },
        ],
    },
    {
        name: 'User', kind: 'user', desc: 'The current signed-in user (`user` / `user()`). Null when signed out.',
        fields: [
            { name: 'id', type: 'string', }, { name: 'name', type: 'string', note: 'alias of displayName', },
            { name: 'displayName', type: 'string', }, { name: 'email', type: 'string', }, { name: 'role', type: 'UserRole', },
            { name: 'avatarUrl', type: 'string?', },
        ],
    },
    {
        name: 'Page', kind: 'page', desc: 'A CMS page (fetched with `page(slug)`).',
        fields: [
            { name: 'id', type: 'string', }, { name: 'slug', type: 'string', }, { name: 'title', type: 'string', },
            { name: 'description', type: 'string?', }, { name: 'status', type: 'PageStatus', }, { name: 'isHomepage', type: 'boolean', },
            { name: 'showInNav', type: 'boolean', }, { name: 'createdAt', type: 'date', }, { name: 'updatedAt', type: 'date', },
        ],
    },
];
