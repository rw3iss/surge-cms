import { viewMediaProps, } from '@/stores/mediaViewer';
import { createSignal, Show, } from 'solid-js';
import MediaSelectModal from '../../media/MediaSelectModal';
import MediaUploadModal from '../../media/MediaUploadModal';

// ─── Branding Media Selector ───

export interface BrandingMediaRef {
    mediaId?: string;
    url?: string;
}

export default function BrandingMediaField(props: {
    label: string;
    value: BrandingMediaRef;
    onChange: (val: BrandingMediaRef,) => void;
},) {
    const [showSelect, setShowSelect,] = createSignal(false,);
    const [showUpload, setShowUpload,] = createSignal(false,);

    return (
        <div class="form-group">
            <label>{props.label}</label>
            <div class="u-flex-row u-flex-wrap">
                <Show when={props.value.url}>
                    <img
                        src={props.value.url}
                        alt={props.label}
                        class="media-viewable"
                        {...viewMediaProps(() => props.value.url,)}
                        style={{
                            'max-height': '40px',
                            'max-width': '120px',
                            'object-fit': 'contain',
                            border: '1px solid #ddd',
                            'border-radius': '4px',
                            padding: '2px',
                        }}
                    />
                </Show>
                <button
                    type="button"
                    class="ui-button ui-button--sm ui-button--secondary"
                    onClick={() => setShowSelect(true,)}
                >
                    Select Media
                </button>
                <button
                    type="button"
                    class="btn btn--small btn--outline"
                    onClick={() => setShowUpload(true,)}
                >
                    Upload New
                </button>
                <Show when={props.value.url}>
                    <button
                        type="button"
                        class="ui-button ui-button--sm ui-button--danger"
                        onClick={() => props.onChange({ mediaId: undefined, url: undefined, },)}
                        title={`Remove ${props.label}`}
                    >
                        &times;
                    </button>
                </Show>
            </div>

            <Show when={showSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        props.onChange({ mediaId: media.id, url: media.url, },);
                        setShowSelect(false,);
                    }}
                    onClose={() => setShowSelect(false,)}
                />
            </Show>
            <Show when={showUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => {
                        props.onChange({ mediaId: media.id, url: media.url, },);
                        setShowUpload(false,);
                    }}
                    onClose={() => setShowUpload(false,)}
                />
            </Show>
        </div>
    );
}
