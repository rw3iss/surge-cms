import { type Component, Show, } from 'solid-js';
import { mediaDeleteRequest, } from '../../../stores/mediaDeleteConfirm';
import ConfirmModal from '../common/ConfirmModal';
import MediaUsageList from './MediaUsageList';

/** Renders the dialog opened by `confirmMediaDelete()`. Mount once (AdminLayout). */
const MediaDeleteConfirmHost: Component = () => (
    <Show when={mediaDeleteRequest()}>
        {(req,) => {
            const inUse = () => req().usages.length > 0;
            const answer = (confirmed: boolean,) => req().resolve({ confirmed, force: confirmed && inUse(), },);
            return (
                <ConfirmModal
                    open={true}
                    title={req().title ?? 'Delete media?'}
                    message={inUse() ? undefined : (req().message ?? 'Delete this file permanently? This cannot be undone.')}
                    confirmLabel={inUse() ? 'Delete anyway' : (req().confirmLabel ?? 'Delete')}
                    danger
                    onConfirm={() => answer(true,)}
                    onCancel={() => answer(false,)}
                >
                    <Show when={inUse()}>
                        <MediaUsageList usages={req().usages} />
                        <p class="confirm-modal__message">
                            Deleting it removes the file — these places will show a broken image or video.
                        </p>
                    </Show>
                </ConfirmModal>
            );
        }}
    </Show>
);

export default MediaDeleteConfirmHost;
