/**
 * `saved()` follows the LAST SAVE, not the entity the editor was opened with.
 *
 * The loaded entity is fetched once and never refetched (a refetch would re-run the editors' hydrate
 * effects over in-progress edits). Everything derived from it — the "View" link above all — therefore
 * kept the values from page open: a clone opened as `home-copy` and saved as `home-draft` still viewed
 * `/home-copy?preview=admin`, a 404.
 */
import { createRoot, } from 'solid-js';
import { describe, expect, it, vi, } from 'vitest';

vi.mock('@solidjs/router', () => ({ useParams: () => ({ id: 'p1', }), useNavigate: () => () => {}, }),);
vi.mock('../components/common/toast', () => ({ useToast: () => ({ success() {}, error() {}, info() {}, }), }),);
vi.mock('./useAppearance', () => ({ useAppearance: () => () => null, }),);
vi.mock('../utils/appearanceStyle', () => ({ appearanceCssVars: () => ({}), }),);
vi.mock('./useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {}, }),);
vi.mock('./useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ isDirty: () => false, markDirty() {}, markClean() {}, }), }),);
vi.mock('./useAutoSave', () => ({
    useAutoSave: () => ({ cancel() {}, clear() {}, status: () => 'idle', lastSavedAt: () => null, }),
}),);

const { useEntityEditor, } = await import('./useEntityEditor');

const tick = () => new Promise((r,) => setTimeout(r, 0,),);

function setup(saveRow: Record<string, unknown> | null,) {
    let ed!: ReturnType<typeof useEntityEditor<{ id: string; slug: string; status: string; }>>;
    createRoot(() => {
        ed = useEntityEditor<{ id: string; slug: string; status: string; }>({
            entityKind: 'page',
            listPath: '/admin/pages',
            status: () => 'draft',
            load: async () => ({ id: 'p1', slug: 'home-copy', status: 'draft', }),
            validate: () => null,
            save: async (ctx,) => { ctx.commit(saveRow,); return 'p1'; },
            autoSaveState: () => ({}),
            softDelete: async () => ({}),
            restore: async () => ({}),
            messages: { saved: () => 'saved', saveError: 'e', deleteError: 'e', restoreError: 'e', },
        } as any,);
    },);
    return ed;
}

describe('useEntityEditor saved()', () => {
    it('reflects the loaded entity before any save', async () => {
        const ed = setup(null,);
        await tick();
        expect(ed.saved()?.slug,).toBe('home-copy',);
    },);

    it('takes the slug and status the server returned after a save', async () => {
        const ed = setup({ id: 'p1', slug: 'home-draft', status: 'published', blocks: [], },);
        await tick();
        await ed.handleSave();
        expect(ed.saved()?.slug,).toBe('home-draft',);
        expect(ed.saved()?.status,).toBe('published',);
        // The loaded entity itself is untouched — the hydrate effects key off it.
        expect(ed.entity()?.slug,).toBe('home-copy',);
    },);

    it('keeps the loaded values when the save reported nothing', async () => {
        const ed = setup(null,);
        await tick();
        await ed.handleSave();
        expect(ed.saved()?.slug,).toBe('home-copy',);
    },);
},);
