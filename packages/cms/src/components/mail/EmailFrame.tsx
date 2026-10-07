/**
 * Shows a rendered EMAIL (a full HTML document with its own inline styles) on
 * a page: a sandboxed iframe, so the email's CSS cannot touch the site and the
 * site's cannot touch it — exactly how a mail client isolates it.
 *
 * Scripts stay disabled. `allow-same-origin` only lets this component read the
 * document's height to size the frame to its content (no inner scrollbar);
 * links get `target="_blank"` so a click opens a tab instead of navigating the
 * tiny frame.
 */
import { createEffect, createSignal, onCleanup, onMount, type Component, } from 'solid-js';
import './EmailFrame.scss';

export interface EmailFrameProps {
    html: string;
    title?: string;
    /** Fixed height (CSS) instead of fitting the content, e.g. inside a modal. */
    height?: string;
    class?: string;
    /**
     * Web-page presentation (the `/mail/:jobId` view): drops the email shell's
     * outer padding (the gutter a mail client shows around the card) and
     * centres block images narrower than their column. A preview of the email
     * AS an email leaves this off.
     */
    flush?: boolean;
}

/** Injected into a `flush` frame. The shell is `body > table > tr > td`
 *  (padding = the gutter); images are `display:block`, which a mail client
 *  left-aligns — on a page they read as misaligned. */
const FLUSH_CSS = '<style>body{margin:0}body>table>tbody>tr>td{padding:0!important}'
    + 'td>img,td>a>img{margin-left:auto!important;margin-right:auto!important}</style>';

/** Make every link open in a new tab (an email's links point off-site). */
function withBaseTarget(html: string, extraHead = '',): string {
    const base = '<base target="_blank">' + extraHead;
    return /<head[^>]*>/i.test(html,) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`,) : base + html;
}

const EmailFrame: Component<EmailFrameProps> = (props,) => {
    let frame: HTMLIFrameElement | undefined;
    const [height, setHeight,] = createSignal(600,);

    const fit = () => {
        const doc = frame?.contentDocument;
        if (!doc?.documentElement) return;
        setHeight(Math.max(200, doc.documentElement.scrollHeight,),);
    };

    // Content sized in viewport units (`80vw`) reflows with the window, and so
    // does its height — re-fit on resize.
    onMount(() => {
        let t: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            clearTimeout(t,);
            t = setTimeout(fit, 150,);
        };
        window.addEventListener('resize', onResize,);
        onCleanup(() => {
            clearTimeout(t,);
            window.removeEventListener('resize', onResize,);
        },);
    },);

    // Images load after `load` fires on slow connections; re-measure once more.
    createEffect(() => {
        void props.html;
        const t = setTimeout(fit, 800,);
        return () => clearTimeout(t,);
    },);

    return (
        <iframe
            ref={frame}
            class={`email-frame ${props.class ?? ''}`}
            title={props.title ?? 'Email'}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            srcdoc={withBaseTarget(props.html, props.flush ? FLUSH_CSS : '',)}
            style={{ height: props.height ?? `${height()}px`, }}
            onLoad={fit}
        />
    );
};

export default EmailFrame;
