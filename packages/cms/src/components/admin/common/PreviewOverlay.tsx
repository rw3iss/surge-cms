import { useNavigate, } from '@solidjs/router';
import { Component, JSX, Show, } from 'solid-js';
import './PreviewOverlay.scss';

interface PreviewOverlayProps {
    backUrl?: string;
    onClose?: () => void;
    /** Title of the entity being previewed (page or post). When set,
     *  shown next to the "Preview Mode" badge so the operator keeps
     *  context of what they're looking at. */
    title?: string;
    /** Status label (e.g. "Draft", "Published"). Renders as a subtle
     *  pill next to the title. */
    status?: string;
    children: JSX.Element;
}

const PreviewOverlay: Component<PreviewOverlayProps> = (props,) => {
    const navigate = useNavigate();

    const handleClose = () => {
        if (props.onClose) {
            props.onClose();
        } else if (props.backUrl) {
            navigate(props.backUrl,);
        }
    };

    return (
        <div class="preview-overlay">
            <div class="preview-overlay__bar">
                <span class="preview-overlay__badge">Preview Mode</span>
                <Show when={props.title}>
                    <span class="preview-overlay__title" title={props.title}>
                        {props.title}
                    </span>
                </Show>
                <Show when={props.status}>
                    <span class="preview-overlay__status">{props.status}</span>
                </Show>
                <button class="preview-overlay__close" onClick={handleClose} title="Close Preview">
                    &times; Close Preview
                </button>
            </div>
            <div class="preview-overlay__content">
                {props.children}
            </div>
        </div>
    );
};

export default PreviewOverlay;
