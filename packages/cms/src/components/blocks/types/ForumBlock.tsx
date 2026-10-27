/**
 * Forum block (`forum`, feature `forum`) — the in-page forum / live
 * discussion widget (`components/forum/ForumWidget`), from the block's
 * settings via `normalizeForumBlockSettings`. `{{ forum(...) }}` renders the
 * same widget (TemplateEntity).
 */
import type { Block, } from '@sitesurge/types';
import { normalizeForumBlockSettings, } from '@sitesurge/types';
import { Component, } from 'solid-js';
import ForumWidget from '../../forum/ForumWidget';

export const ForumBlock: Component<{ block: Block; preview?: boolean; }> = (props,) => (
    <ForumWidget settings={normalizeForumBlockSettings(props.block.settings,)} preview={props.preview} />
);
