/** Pure helpers for a template's uses (TemplateDeleteConfirm). */
import type { TemplateUsage, } from '@sitesurge/types';

/** Editor link for a use; null for another template (its type is not known here). */
export function usageHref(u: TemplateUsage,): string | null {
    switch (u.kind) {
        case 'page': return `/admin/pages/${u.id}`;
        case 'post': return `/admin/posts/${u.id}`;
        case 'mail_template': return `/admin/mail-templates/${u.id}`;
        default: return null;
    }
}

export const usageKind = (k: TemplateUsage['kind'],): string =>
    ({ page: 'Page', post: 'Post', mail_template: 'Email template', template: 'Template', } as const)[k];

/** Delete is allowed when nothing uses the template, or the typed text matches its name. */
export function templateDeleteAllowed(usages: TemplateUsage[] | null, typed: string, name: string,): boolean {
    return (usages?.length ?? 0) === 0 || typed.trim() === name.trim();
}
