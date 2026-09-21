/**
 * Paste-cleanup RULES, tested as pure predicates.
 *
 * `cleanPastedHtml` itself needs a DOM and is verified in a browser; this
 * package's test environment has none, and the decisions worth pinning are the
 * predicates that drive it.
 */
import { describe, expect, it, } from 'vitest';
import { isChromeFont, stripsFontSize, } from './pasteCleanup';

describe('stripsFontSize', () => {
    it.each(['span', 'a', 'font', 'strong', 'em', 'b', 'i', 'u',],)(
        'drops a pasted font-size from inline <%s>', (tag,) => {
            expect(stripsFontSize(tag,),).toBe(true,);
        },
    );

    it.each(['p', 'h1', 'h2', 'div', 'li', 'blockquote',],)(
        'keeps a pasted font-size on block <%s>', (tag,) => {
            // A heading's size is meaningful; flattening it would destroy a
            // pasted document's hierarchy.
            expect(stripsFontSize(tag,),).toBe(false,);
        },
    );

    it('is case-insensitive', () => {
        expect(stripsFontSize('SPAN',),).toBe(true,);
    },);
},);

describe('isChromeFont', () => {
    it('recognises the admin mono stack exactly as the browser serialises it', () => {
        // Verbatim from a template that had a {{ variable }} pasted out of the
        // in-admin reference — the string the clipboard actually produced.
        const pasted = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
        expect(isChromeFont(pasted,),).toBe(true,);
    },);

    it.each([
        '"IBM Plex Sans", -apple-system, "Segoe UI", Roboto, sans-serif',
        '"Manrope", "Inter", -apple-system, sans-serif',
    ],)('recognises the other admin faces: %j', (v,) => {
        // Copying a whole paragraph out of the admin drags --admin-font-body
        // along, pinning the text to a font the recipient will not have.
        expect(isChromeFont(v,),).toBe(true,);
    },);

    it.each([
        "'JetBrains Mono', monospace",
        'JetBrains Mono, monospace',
        'jetbrains mono',
        '  "JetBrains Mono"  , Menlo',
    ],)('matches however it is quoted or spaced: %j', (v,) => {
        expect(isChromeFont(v,),).toBe(true,);
    },);

    it.each([
        'Arial, sans-serif',
        'Georgia, serif',
        'monospace',
        'ui-monospace, SFMono-Regular, monospace',
        'Menlo, monospace',
        '',
    ],)('leaves a real authorial choice alone: %j', (v,) => {
        // Only the FIRST family decides. A legitimately chosen `monospace`, or
        // a stack that merely CONTAINS ui-monospace further down, is content.
        expect(isChromeFont(v,),).toBe(false,);
    },);

    it('survives a null-ish value', () => {
        expect(isChromeFont(undefined as never,),).toBe(false,);
    },);
},);
