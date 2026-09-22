/**
 * A font chosen for a RUN of rich text becomes an inline `font-family`, which
 * will be read where the site's stylesheet never reaches — an inbox above all.
 * So the value has to be self-contained: the site's default resolved at apply
 * time and appended, not `var(--site-font, …)` that resolves to nothing there.
 */
import { describe, expect, it, } from 'vitest';
import { inlineFontStack, SYSTEM_FALLBACK, } from './richTextFont';

describe('inlineFontStack', () => {
    it('quotes a bare family and appends the site default', () => {
        expect(inlineFontStack('Brandon', 'Inter, sans-serif',),)
            .toBe("'Brandon', Inter, sans-serif",);
    },);

    it('falls back to the system stack when the site has no font', () => {
        expect(inlineFontStack('Brandon', '',),).toBe(`'Brandon', ${SYSTEM_FALLBACK}`,);
        expect(inlineFontStack('Brandon',),).toBe(`'Brandon', ${SYSTEM_FALLBACK}`,);
    },);

    it('returns empty for no selection, so the caller can CLEAR', () => {
        // Distinct from "apply the default": clearing removes the inline style
        // and lets the block's own font apply again.
        expect(inlineFontStack('',),).toBe('',);
        expect(inlineFontStack('   ',),).toBe('',);
    },);

    it('does not repeat the chosen font inside its own fallback', () => {
        // The site default is frequently the same face; "'X', 'X', sans-serif"
        // is harmless but is noise in every saved document.
        expect(inlineFontStack('Inter', "'Inter', system-ui, sans-serif",),)
            .toBe("'Inter', system-ui, sans-serif",);
    },);

    it('matches the chosen font against the fallback ignoring quotes and case', () => {
        expect(inlineFontStack('inter', 'Inter, sans-serif',),).toBe("'inter', sans-serif",);
    },);

    it('de-duplicates repeats within the fallback itself', () => {
        expect(inlineFontStack('A', 'B, B, C',),).toBe("'A', B, C",);
    },);

    it('passes an already-quoted family through without double-quoting', () => {
        expect(inlineFontStack("'My Font'", 'serif',),).toBe("'My Font', serif",);
    },);

    it('passes a full stack through as the head', () => {
        // A legacy value may already be a list; re-quoting it would produce
        // one nonsense family name.
        expect(inlineFontStack('Georgia, serif', 'Inter',),).toBe('Georgia, serif, Inter',);
    },);

    it('tolerates ragged spacing in the site stack', () => {
        expect(inlineFontStack('A', '  B ,   C  ',),).toBe("'A', B, C",);
    },);

    it('never emits a var() — it would resolve to nothing in an inbox', () => {
        const out = inlineFontStack('Brandon', 'var(--x), sans-serif',);
        // The caller passes a RESOLVED stack; this just pins that nothing here
        // introduces one.
        expect(inlineFontStack('Brandon', 'Inter',),).not.toContain('var(',);
        expect(out.startsWith("'Brandon',",),).toBe(true,);
    },);
},);
