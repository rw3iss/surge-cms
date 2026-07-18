/** Expression lexer + recursive-descent parser (pure, synchronous).
 *  Grammar (lowest → highest precedence):
 *    or   := and  ( ('||'|'or')  and  )*
 *    and  := eq   ( ('&&'|'and') eq   )*
 *    eq   := cmp  ( ('=='|'!=')  cmp  )*
 *    cmp  := unary( ('>'|'<'|'>='|'<=') unary )*
 *    unary:= ('!'|'not') unary | primary
 *    primary := literal | call | path | '(' or ')'
 *    call := IDENT '(' [ or (',' or)* ] ')' ('.' IDENT)*
 *    path := IDENT ('.' IDENT)*
 */
import type { BinaryOp, Expr } from './types';
import { TemplateParseError } from './types';

type Tok =
    | { t: 'ident'; v: string }
    | { t: 'num'; v: number }
    | { t: 'str'; v: string }
    | { t: 'op'; v: string }
    | { t: 'eof' };

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<', '!', '(', ')', ',', '.'];

function lex(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if (c === '"' || c === "'") {
            const quote = c;
            let s = '';
            i++;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\' && i + 1 < src.length) { s += src[i + 1]; i += 2; }
                else { s += src[i]; i++; }
            }
            i++; // closing quote
            out.push({ t: 'str', v: s });
            continue;
        }
        if (c >= '0' && c <= '9') {
            let n = '';
            while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i++; }
            out.push({ t: 'num', v: parseFloat(n) });
            continue;
        }
        // multi-char then single-char operators
        const two = src.slice(i, i + 2);
        if (OPS.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
        if (OPS.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
        // identifier (letters, digits, underscore, hyphen) — hyphen lets bare
        // ids like `post-id` parse; ids are best passed quoted though.
        if (/[A-Za-z_]/.test(c)) {
            let id = '';
            while (i < src.length && /[A-Za-z0-9_-]/.test(src[i])) { id += src[i]; i++; }
            out.push({ t: 'ident', v: id });
            continue;
        }
        throw new TemplateParseError(`Unexpected character '${c}' in expression`);
    }
    out.push({ t: 'eof' });
    return out;
}

class Parser {
    private pos = 0;
    constructor(private toks: Tok[]) {}

    private peek(): Tok { return this.toks[this.pos]; }
    private next(): Tok { return this.toks[this.pos++]; }
    private isOp(v: string): boolean { const t = this.peek(); return t.t === 'op' && t.v === v; }
    private eatOp(v: string): boolean { if (this.isOp(v)) { this.pos++; return true; } return false; }
    private isKeyword(v: string): boolean { const t = this.peek(); return t.t === 'ident' && t.v === v; }

    parse(): Expr {
        const e = this.parseOr();
        if (this.peek().t !== 'eof') throw new TemplateParseError('Trailing tokens in expression');
        return e;
    }

    private parseOr(): Expr {
        let left = this.parseAnd();
        while (this.isOp('||') || this.isKeyword('or')) {
            this.next();
            left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
        }
        return left;
    }
    private parseAnd(): Expr {
        let left = this.parseEquality();
        while (this.isOp('&&') || this.isKeyword('and')) {
            this.next();
            left = { kind: 'binary', op: '&&', left, right: this.parseEquality() };
        }
        return left;
    }
    private parseEquality(): Expr {
        let left = this.parseComparison();
        while (this.isOp('==') || this.isOp('!=')) {
            const op = (this.next() as { v: string }).v as BinaryOp;
            left = { kind: 'binary', op, left, right: this.parseComparison() };
        }
        return left;
    }
    private parseComparison(): Expr {
        let left = this.parseUnary();
        while (this.isOp('>=') || this.isOp('<=') || this.isOp('>') || this.isOp('<')) {
            const op = (this.next() as { v: string }).v as BinaryOp;
            left = { kind: 'binary', op, left, right: this.parseUnary() };
        }
        return left;
    }
    private parseUnary(): Expr {
        if (this.isOp('!') || this.isKeyword('not')) {
            this.next();
            return { kind: 'unary', op: '!', operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }
    private parsePrimary(): Expr {
        const t = this.peek();
        if (this.eatOp('(')) {
            const e = this.parseOr();
            if (!this.eatOp(')')) throw new TemplateParseError("Expected ')'");
            return e;
        }
        if (t.t === 'num') { this.next(); return { kind: 'lit', value: t.v }; }
        if (t.t === 'str') { this.next(); return { kind: 'lit', value: t.v }; }
        if (t.t === 'ident') {
            const name = t.v;
            if (name === 'true') { this.next(); return { kind: 'lit', value: true }; }
            if (name === 'false') { this.next(); return { kind: 'lit', value: false }; }
            if (name === 'null') { this.next(); return { kind: 'lit', value: null }; }
            this.next();
            if (this.isOp('(')) {
                // function call
                this.next();
                const args: Expr[] = [];
                if (!this.isOp(')')) {
                    args.push(this.parseOr());
                    while (this.eatOp(',')) args.push(this.parseOr());
                }
                if (!this.eatOp(')')) throw new TemplateParseError("Expected ')' after arguments");
                const props = this.parsePropChain();
                return { kind: 'call', name, args, props };
            }
            // dotted path
            const parts = [name, ...this.parsePropChain()];
            return { kind: 'path', parts };
        }
        throw new TemplateParseError('Unexpected token in expression');
    }
    private parsePropChain(): string[] {
        const props: string[] = [];
        while (this.eatOp('.')) {
            const t = this.peek();
            if (t.t !== 'ident') throw new TemplateParseError("Expected property name after '.'");
            props.push(t.v);
            this.next();
        }
        return props;
    }
}

export function parseExpression(src: string): Expr {
    return new Parser(lex(src)).parse();
}
