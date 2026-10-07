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
import { createEffect, createSignal, type Component, } from 'solid-js';
import './EmailFrame.scss';

export interface EmailFrameProps {
    html: string;
    title?: string;
    /** Fixed height (CSS) instead of fitting the content, e.g. inside a modal. */
    height?: string;
    class?: string;
}

/** Make every link open in a new tab (an email's links point off-site). */
function withBaseTarget(html: string,): string {
    const base = '<base target="_blank">';
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
            srcdoc={withBaseTarget(props.html,)}
            style={{ height: props.height ?? `${height()}px`, }}
            onLoad={fit}
        />
    );
};

export default EmailFrame;
