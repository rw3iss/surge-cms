import { useNavigate, } from '@solidjs/router';
import { Component, JSX, } from 'solid-js';
import './PreviewOverlay.scss';

interface PreviewOverlayProps {
    backUrl?: string;
    onClose?: () => void;
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
