import type { Post, PostTypeDefinition, } from '@sitesurge/types';
import type { EntityEditorController, } from '../../../../hooks/useEntityEditor';
import type { BlockData, } from '../../blocks/ContentBlock';

/**
 * Props every post-type editor (`types/<key>/index.tsx`) receives. The Post
 * editor owns all state; an editor only renders the Content section and lifts
 * changes through the callbacks. Read props inside JSX / effects (Solid props
 * are reactive getters — do not destructure).
 */
export interface PostTypeEditorProps {
    /** Saved post id, or null while the post is new (not saved yet). */
    postId: string | null;
    /** The current type's definition (`getPostType(postType)`). */
    definition: PostTypeDefinition;
    /** The Post editor's controller (dirty tracking, autosave, save, entity…). */
    editor: EntityEditorController<Post>;

    // ─── Content blocks (same contract the shell's BlockEditor used) ───
    blocks: BlockData[];
    /** Snapshot as last saved — dirty detection + per-block revert. */
    savedBlocks: BlockData[];
    /** Replace the block list (the host marks the post dirty). */
    onBlocksChange: (blocks: BlockData[],) => void;
    /** Full-width preview toggle → the host adds `.admin-full-bleed`. */
    onFullWidthChange: (full: boolean,) => void;
    /** Site appearance vars for the block canvas. */
    containerStyle: Record<string, string>;

    // ─── Per-type settings (`posts.type_settings`) ───
    typeSettings: Record<string, unknown>;
    /** Replace the settings object (the host marks the post dirty). */
    onTypeSettingsChange: (next: Record<string, unknown>,) => void;

    // ─── Post state an editor may need ───
    title: string;
    status: string;
    /** ISO string or null. */
    liveStartedAt: string | null;
    /** ISO string or null. Set = the show ended (no live room). */
    liveEndedAt: string | null;
}
