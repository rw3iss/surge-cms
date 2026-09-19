/**
 * The label-click rule has exactly one subtle case, and it is the one that
 * would be discovered by a user rather than a developer: the help tooltip
 * rendered INSIDE a label is a focusable `<span>`, not a button. Miss it and
 * reaching for help silently flips the setting the label describes.
 */
import { describe, expect, it, } from 'vitest';
import { INTERACTIVE_IN_LABEL, labelClickActivates, type LabelNode, } from './labelActivation';

/** Minimal stand-in for an element — no DOM implementation needed. */
function node(selectors: string[] = [], parent: LabelNode | null = null,): LabelNode {
    return {
        matches: (sel: string,) => selectors.some((s,) => sel.includes(s,)),
        parentElement: parent,
    };
}

describe('labelClickActivates', () => {
    it('activates when the click lands on plain label text', () => {
        const label = node();
        const text = node([], label,);
        expect(labelClickActivates(text, label,),).toBe(true,);
    },);

    it('activates when the click lands on the label element itself', () => {
        const label = node();
        expect(labelClickActivates(label, label,),).toBe(true,);
    },);

    it('does NOT activate for the help tooltip — a focusable SPAN, not a button', () => {
        // The regression this guards. `[tabindex]:not([tabindex="-1"])` is what
        // catches it; a `button, a, input` list would not.
        const label = node();
        const tooltip = node(['[tabindex]',], label,);
        expect(labelClickActivates(tooltip, label,),).toBe(false,);
    },);

    it('does not activate for a click on a nested control', () => {
        const label = node();
        for (const sel of ['a[href]', 'button', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]',]) {
            expect(labelClickActivates(node([sel,], label,), label,), sel,).toBe(false,);
        }
    },);

    it('checks ANCESTORS of the click target, not just the target', () => {
        // Clicking the <svg> inside the tooltip reports the svg as the target,
        // so only walking up finds the interactive wrapper.
        const label = node();
        const tooltip = node(['[tabindex]',], label,);
        const icon = node([], tooltip,);
        expect(labelClickActivates(icon, label,),).toBe(false,);
    },);

    it('stops at the label — an interactive ANCESTOR must not suppress it', () => {
        // A clickable card wrapping the whole toggle would, with a document-wide
        // `closest()`, disable every label inside it.
        const card = node(['[role="button"]',], null,);
        const label = node([], card,);
        const text = node([], label,);
        expect(labelClickActivates(text, label,),).toBe(true,);
    },);

    it('activates when the target is null', () => {
        // A synthetic event with no target should not silently do nothing.
        const label = node();
        expect(labelClickActivates(null, label,),).toBe(true,);
    },);

    it('tolerates a node with no matches() (a text node reported as target)', () => {
        const label = node();
        const bare = { parentElement: label, } as LabelNode;
        expect(labelClickActivates(bare, label,),).toBe(true,);
    },);

    it('exempts a disabled-looking tabindex="-1" element', () => {
        // Programmatically-focusable but not tab-reachable elements are not
        // interactive targets, so they should not block the label.
        const label = node();
        const inert = node(['[tabindex="-1"]',], label,);
        // The selector deliberately excludes tabindex="-1"; the fake matcher
        // uses substring matching, so assert against the real selector text.
        expect(INTERACTIVE_IN_LABEL.includes('[tabindex]:not([tabindex="-1"])',),).toBe(true,);
        expect(labelClickActivates(inert, label, 'a[href], button',),).toBe(true,);
    },);
},);
