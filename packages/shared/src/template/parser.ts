/** Stage 2: token stream → AST (interpolations + if/for control flow). */
import { parseExpression } from './expression';
import { tokenize, type Token } from './tokenizer';
import type { IfBranch, Node } from './types';
import { TemplateParseError } from './types';

const RE_IF = /^if\s+(.+)$/s;
const RE_ELSEIF = /^else\s*if\s+(.+)$/s;
const RE_ELSE = /^else$/;
const RE_ENDIF = /^endif$/;
const RE_FOR = /^for\s+(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?$/s;
const RE_ENDFOR = /^endfor$/;

class Parser {
    private pos = 0;
    constructor(private toks: Token[]) {}

    private peek(): Token | undefined { return this.toks[this.pos]; }

    /** Parse a sequence of nodes until one of `stopTags` (a control keyword) is
     *  seen at the head — that closing tag is left unconsumed for the caller. */
    parseNodes(stopTags: RegExp[]): Node[] {
        const nodes: Node[] = [];
        while (this.pos < this.toks.length) {
            const tok = this.toks[this.pos];
            if (tok.type === 'text') { nodes.push({ kind: 'text', value: tok.value }); this.pos++; continue; }
            // tag
            if (stopTags.some((re) => re.test(tok.value))) return nodes;

            if (RE_IF.test(tok.value)) { nodes.push(this.parseIf()); continue; }
            if (RE_FOR.test(tok.value)) { nodes.push(this.parseFor()); continue; }
            // A stray closing tag with no opener is a parse error.
            if (RE_ELSEIF.test(tok.value) || RE_ELSE.test(tok.value) || RE_ENDIF.test(tok.value) || RE_ENDFOR.test(tok.value)) {
                throw new TemplateParseError(`Unexpected '{{${tok.value}}}'`);
            }
            // interpolation
            nodes.push({ kind: 'interp', expr: parseExpression(tok.value), raw: tok.value });
            this.pos++;
        }
        return nodes;
    }

    private parseIf(): Node {
        const branches: IfBranch[] = [];
        const openTag = this.toks[this.pos].value; // "if <cond>"
        this.pos++;
        branches.push({ cond: parseExpression(RE_IF.exec(openTag)![1]), body: this.parseNodes([RE_ELSEIF, RE_ELSE, RE_ENDIF]) });

        // else-if chain
        while (this.peek() && this.peek()!.type === 'tag' && RE_ELSEIF.test(this.peek()!.value)) {
            const t = this.toks[this.pos].value;
            this.pos++;
            branches.push({ cond: parseExpression(RE_ELSEIF.exec(t)![1]), body: this.parseNodes([RE_ELSEIF, RE_ELSE, RE_ENDIF]) });
        }
        // else
        if (this.peek() && this.peek()!.type === 'tag' && RE_ELSE.test(this.peek()!.value)) {
            this.pos++;
            branches.push({ cond: null, body: this.parseNodes([RE_ENDIF]) });
        }
        // endif
        if (!this.peek() || this.peek()!.type !== 'tag' || !RE_ENDIF.test(this.peek()!.value)) {
            throw new TemplateParseError("Missing '{{endif}}'");
        }
        this.pos++;
        return { kind: 'if', branches };
    }

    private parseFor(): Node {
        const openTag = this.toks[this.pos].value;
        const m = RE_FOR.exec(openTag)!;
        this.pos++;
        const list = parseExpression(m[1]);
        const item = m[2];
        const index = m[3] ?? null;
        const body = this.parseNodes([RE_ENDFOR]);
        if (!this.peek() || this.peek()!.type !== 'tag' || !RE_ENDFOR.test(this.peek()!.value)) {
            throw new TemplateParseError("Missing '{{endfor}}'");
        }
        this.pos++;
        return { kind: 'for', list, item, index, body };
    }
}

/** Parse a template source string into an AST. Throws TemplateParseError on
 *  malformed control flow / expressions. */
export function parse(src: string): Node[] {
    const toks = tokenize(src);
    const p = new Parser(toks);
    const nodes = p.parseNodes([]);
    return nodes;
}
