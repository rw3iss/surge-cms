export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PASSWORD_MIN_LENGTH = 8;

export function isValidEmail(email: string,): boolean {
    return EMAIL_REGEX.test(email,);
}

export function isValidSlug(slug: string,): boolean {
    return SLUG_REGEX.test(slug,);
}

export function isValidPassword(password: string,): { valid: boolean; errors: string[]; } {
    const errors: string[] = [];

    if (password.length < PASSWORD_MIN_LENGTH) {
        errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`,);
    }

    if (!/[A-Z]/.test(password,)) {
        errors.push('Password must contain at least one uppercase letter',);
    }

    if (!/[a-z]/.test(password,)) {
        errors.push('Password must contain at least one lowercase letter',);
    }

    if (!/[0-9]/.test(password,)) {
        errors.push('Password must contain at least one number',);
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function generateSlug(text: string,): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '',)
        .replace(/[\s_-]+/g, '-',)
        .replace(/^-+|-+$/g, '',);
}

// Basic client-side fallback sanitizer. The real sanitization happens server-side
// using the sanitize-html package in backend/src/utils/sanitize.ts.
export function sanitizeHtml(html: string,): string {
    const tagWhitelist = [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'a',
        'ul',
        'ol',
        'li',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'pre',
        'code',
        'img',
    ];
    const attrWhitelist = ['href', 'src', 'alt', 'title', 'class', 'target', 'rel',];

    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '',)
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '',)
        .replace(/on\w+="[^"]*"/gi, '',)
        .replace(/on\w+='[^']*'/gi, '',)
        .replace(/javascript:/gi, '',);
}

export function truncate(text: string, maxLength: number, suffix = '...',): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length,).trim() + suffix;
}
