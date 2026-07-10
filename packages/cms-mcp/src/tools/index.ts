/**
 * Assembles every tool group into the flat registry the server registers.
 * Phases B–E append their groups here (pages, posts, blockStyles, appearance,
 * layout, settings, media, navigation, reference).
 */
import type { ToolDef, } from '../tool';
import { metaTools, } from './meta';
import { pageTools, } from './pages';
import { postTools, } from './posts';
import { blockStyleTools, } from './blockStyles';
import { appearanceTools, } from './appearance';
import { layoutTools, } from './layout';
import { settingsTools, } from './settings';
import { mediaTools, } from './media';
import { navigationTools, } from './navigation';
import { referenceTools, } from './reference';

export function allTools(): ToolDef[] {
    return [
        ...metaTools,
        ...pageTools,
        ...postTools,
        ...blockStyleTools,
        ...appearanceTools,
        ...layoutTools,
        ...settingsTools,
        ...mediaTools,
        ...navigationTools,
        ...referenceTools,
    ];
}
