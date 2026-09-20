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
    // `style` is allowed here for the same reason it is on `span`: without it
    // a link inside styled text lost its sizing while the spans around it kept
    // theirs, so a link rendered at a different size from the sentence it sits
    // in. The asymmetry was the bug, not the style attribute.
    'a': ['href', 'title', 'target', 'rel', 'style',],
    'img': ['src', 'alt', 'title', 'width', 'height', 'loading',],
    'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'loading', 'allow',],
    'video': ['src', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted', 'poster',],
    'source': ['src', 'type',],
    'audio': ['src', 'controls',],
    // Block elements keep `style` + `align` so the rich-text editor's alignment
    // buttons (execCommand justify* → `text-align`/`align`) survive sanitize.
    'p': ['style', 'align',],
    'h1': ['style', 'align',],
    'h2': ['style', 'align',],
    'h3': ['style', 'align',],
    'h4': ['style', 'align',],
    'h5': ['style', 'align',],
    'h6': ['style', 'align',],
    'blockquote': ['style', 'align',],
    'ul': ['style',],
    'ol': ['style',],
    'li': ['style', 'align',],
    'figure': ['style',],
    'figcaption': ['style',],
    'pre': ['style',],
    'td': ['colspan', 'rowspan', 'style', 'align',],
    'th': ['colspan', 'rowspan', 'style', 'align',],
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
