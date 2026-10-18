/**
 * Hero block panel (moved out of BlockEditController).
 *
 * The background image goes through the shared `ImageLinkPicker` — Select
 * Media / Upload New / a typed URL, with the full-size viewer — like every
 * other image field in the editor. Text fields commit on blur.
 */
import { Component, } from 'solid-js';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';
import ImageLinkPicker, { type ImageLinkValue, } from '../../media/ImageLinkPicker';

export interface HeroBlockEditProps {
    data: Record<string, any>;
    onUpdate: (d: Record<string, any>,) => void;
}

const HeroBlockEdit: Component<HeroBlockEditProps> = (props,) => {
    const set = (patch: Record<string, unknown>,) => props.onUpdate({ ...props.data, ...patch, },);
    // `backgroundImage` stays the one URL the renderer reads; the media id rides
    // beside it only so the picker can show "selected from the library".
    const fromLibrary = () => Boolean(props.data.backgroundImageMediaId,);
    const onImage = (patch: Partial<ImageLinkValue>,) => {
        if ('mediaUrl' in patch || 'mediaId' in patch) {
            set({ backgroundImage: patch.mediaUrl ?? '', backgroundImageMediaId: patch.mediaId, },);
        } else if ('imageUrl' in patch) {
            set({ backgroundImage: patch.imageUrl ?? '', backgroundImageMediaId: undefined, },);
        }
    };
    return (
        <>
            <FormField label="Hero Title">
                <CommitInput value={props.data.title} onCommit={(v,) => set({ title: v, },)} placeholder="Hero title..." />
            </FormField>
            <FormField label="Subtitle">
                <CommitInput value={props.data.subtitle} onCommit={(v,) => set({ subtitle: v, },)} placeholder="Subtitle..." />
            </FormField>
            <FormField label="Content" hint="HTML. {{ }} variables are supported.">
                <CommitInput multiline rows={4} value={props.data.content} onCommit={(v,) => set({ content: v, },)} placeholder="Hero content (HTML)..." />
            </FormField>
            <FormField label="Background Image">
                <ImageLinkPicker
                    mediaId={props.data.backgroundImageMediaId}
                    mediaUrl={fromLibrary() ? props.data.backgroundImage : undefined}
                    imageUrl={fromLibrary() ? '' : props.data.backgroundImage}
                    onChange={onImage}
                />
            </FormField>
            <FormField label="Min Height" hint="Any CSS length: 300px, 50vh, clamp(…)">
                <CommitInput value={props.data.minHeight} onCommit={(v,) => set({ minHeight: v, },)} placeholder="e.g. 300px, 50vh" />
            </FormField>
        </>
    );
};

export default HeroBlockEdit;
