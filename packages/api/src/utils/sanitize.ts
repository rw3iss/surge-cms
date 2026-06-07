import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'ins',
    'a',
    'img',
    'figure',
    'figcaption',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'div',
    'span',
    'iframe', // For social embeds
    'video',
    'source',
    'audio',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
    'a': ['href', 'title', 'target', 'rel',],
    'img': ['src', 'alt', 'title', 'width', 'height', 'loading',],
    'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'loading', 'allow',],
    'video': ['src', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted', 'poster',],
    'source': ['src', 'type',],
    'audio': ['src', 'controls',],
    'td': ['colspan', 'rowspan',],
    'th': ['colspan', 'rowspan',],
    'div': ['class', 'id', 'style',],
    'span': ['class', 'style',],
    '*': ['class',],
};

// Only allow safe iframe sources
const ALLOWED_IFRAME_DOMAINS = [
    'www.youtube.com',
    'youtube.com',
    'www.instagram.com',
    'instagram.com',
    'www.facebook.com',
    'facebook.com',
    'platform.twitter.com',
    'www.tiktok.com',
    'tiktok.com',
    'player.vimeo.com',
];

export function sanitize(html: string,): string {
    return sanitizeHtml(html, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedIframeHostnames: ALLOWED_IFRAME_DOMAINS,
        allowedSchemes: ['http', 'https', 'mailto',],
        transformTags: {
            'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', },),
        },
    },);
}
