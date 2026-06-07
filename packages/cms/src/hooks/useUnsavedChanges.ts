import { useBeforeLeave, } from '@solidjs/router';
import { createSignal, onCleanup, } from 'solid-js';

export function useUnsavedChanges() {
    const [isDirty, setIsDirty,] = createSignal(false,);

    // Browser close/refresh warning
    const handleBeforeUnload = (e: BeforeUnloadEvent,) => {
        if (isDirty()) {
            e.preventDefault();
            e.returnValue = '';
        }
    };

    window.addEventListener('beforeunload', handleBeforeUnload,);
    onCleanup(() => window.removeEventListener('beforeunload', handleBeforeUnload,));

    // Router navigation warning
    useBeforeLeave((e,) => {
        if (isDirty() && !e.defaultPrevented) {
            e.preventDefault();
            if (window.confirm('You have unsaved changes. Are you sure you want to leave?',)) {
                e.retry(true,);
            }
        }
    },);

    const markDirty = () => setIsDirty(true,);
    const markClean = () => setIsDirty(false,);

    return { isDirty, markDirty, markClean, };
}
