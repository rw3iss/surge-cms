import { onCleanup, onMount, } from 'solid-js';

interface ShortcutDefinition {
    /** Key identifier, e.g. 's', 'Escape', 'k' */
    key: string;
    /** Require Ctrl/Cmd modifier */
    ctrl?: boolean;
    /** Require Shift modifier */
    shift?: boolean;
    /** Require Alt modifier */
    alt?: boolean;
    /** Handler function */
    handler: (e: KeyboardEvent,) => void;
    /** Prevent default browser action */
    preventDefault?: boolean;
    /** Skip if focused element is an input/textarea/contenteditable */
    skipInputs?: boolean;
}

/**
 * Register keyboard shortcuts that clean up on unmount.
 * Supports Ctrl/Cmd (same key), Shift, Alt modifiers.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[],): void {
    const handler = (e: KeyboardEvent,) => {
        for (const s of shortcuts) {
            const ctrlMatch = s.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
            const shiftMatch = !!s.shift === e.shiftKey;
            const altMatch = !!s.alt === e.altKey;
            const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();

            if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
                if (s.skipInputs !== false) {
                    const target = e.target as HTMLElement;
                    if (
                        target &&
                        (target.tagName === 'INPUT' ||
                            target.tagName === 'TEXTAREA' ||
                            target.isContentEditable)
                    ) {
                        // Allow Ctrl+S even in inputs (it's the universal save shortcut)
                        if (!(s.ctrl && s.key.toLowerCase() === 's')) continue;
                    }
                }
                if (s.preventDefault !== false) e.preventDefault();
                s.handler(e,);
                return;
            }
        }
    };

    onMount(() => {
        window.addEventListener('keydown', handler,);
    },);

    onCleanup(() => {
        window.removeEventListener('keydown', handler,);
    },);
}
