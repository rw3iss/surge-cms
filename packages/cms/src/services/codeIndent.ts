/**
 * What the Tab key inserts in every code editor in the admin.
 *
 * One place, because the alternative is each editor inventing its own and the
 * same document coming out half tabs and half spaces depending on which screen
 * it was edited from.
 *
 * The value is an appearance setting (`codeTabWidth`) so an operator picks it
 * once and it applies to the custom-CSS field, the HTML block, and anything
 * added later.
 */
import { indentUnit, } from '@codemirror/language';
import { indentWithTab, } from '@codemirror/commands';
import { keymap, } from '@codemirror/view';
import type { Extension, } from '@codemirror/state';

export type CodeTabWidth = '4' | '2' | 'tab';

/** The literal string one Tab press inserts. */
export function indentString(width: CodeTabWidth | undefined,): string {
    if (width === 'tab') return '\t';
    if (width === '2') return '  ';
    return '    ';
}

/**
 * CodeMirror extensions binding Tab to the configured indent.
 *
 * `indentWithTab` is deliberately opt-in in CodeMirror because capturing Tab
 * costs keyboard users the ability to move focus out of the editor. That is the
 * right default for a page full of fields, but a code editor is exactly the
 * case where typing an indent is what Tab is for — and Escape still releases
 * focus, so the accessibility escape hatch remains.
 */
export function indentExtensions(width: CodeTabWidth | undefined,): Extension[] {
    return [
        indentUnit.of(indentString(width,),),
        keymap.of([indentWithTab,],),
    ];
}
