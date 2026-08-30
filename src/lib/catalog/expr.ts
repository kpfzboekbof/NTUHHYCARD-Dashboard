/**
 * The applicability expression language.
 *
 * Deliberately tiny: field comparisons, `in`, `&&`, `||`, parentheses, plus
 * `studyIdNum` and `batch('slug').cutoff`. It exists so rules like "Lab ICU
 * only applies once sur_icu is 1" live in the catalog instead of in an inline
 * array literal inside the transform.
 *
 * Evaluation is TRI-STATE. A field nobody has filled in yet answers UNKNOWN,
 * never false — that is what lets the dashboard distinguish "does not apply to
 * this patient" from "we cannot know until someone upstream fills the field",
 * which the old boolean logic rendered identically (and in red).
 */

export type Tri = 'true' | 'false' | 'unknown';

export interface ExprContext {
  /**
   * Values visible for a field on this record. Empty means nothing is entered,
   * which is what makes an expression UNKNOWN. Fields declared with
   * aggregation 'any' return every value across the repeating rows.
   */
  fieldValues(field: string): string[];
  studyIdNum: number;
  /** Cutoff for a batch slug, or null when no such batch exists. */
  batchCutoff(slug: string): number | null;
}

/* ── tokenizer ─────────────────────────────────────────────── */

type TokenType = 'string' | 'number' | 'ident' | 'op' | 'punct';
interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>'];

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "'" || char === '"') {
      const end = input.indexOf(char, i + 1);
      if (end === -1) throw new ExprError(`未結束的字串：${input.slice(i)}`);
      tokens.push({ type: 'string', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    const twoChar = input.slice(i, i + 2);
    if (OPERATORS.includes(twoChar)) {
      tokens.push({ type: 'op', value: twoChar });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i++;
      continue;
    }

    if ('(),.'.includes(char)) {
      tokens.push({ type: 'punct', value: char });
      i++;
      continue;
    }

    const rest = input.slice(i);
    const number = /^\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: 'number', value: number[0] });
      i += number[0].length;
      continue;
    }

    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0] });
      i += ident[0].length;
      continue;
    }

    throw new ExprError(`無法解析的字元：${char}`);
  }

  return tokens;
}

/* ── AST ───────────────────────────────────────────────────── */

export type Node =
  | { kind: 'literal'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'field'; name: string }
  | { kind: 'studyId' }
  | { kind: 'batchCutoff'; slug: string }
  | { kind: 'list'; items: Node[] }
  | { kind: 'compare'; op: string; left: Node; right: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node };

/* ── parser ────────────────────────────────────────────────── */

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new ExprError(`多餘的內容：${this.tokens[this.pos].value}`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(type: TokenType, value?: string): Token {
    const token = this.peek();
    if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
      throw new ExprError(`預期 ${value ?? type}，實際為 ${token ? token.value : '結尾'}`);
    }
    this.pos++;
    return token;
  }

  private matchOp(...values: string[]): string | undefined {
    const token = this.peek();
    if (token && token.type === 'op' && values.includes(token.value)) {
      this.pos++;
      return token.value;
    }
    return undefined;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.matchOp('||')) {
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseCompare();
    while (this.matchOp('&&')) {
      left = { kind: 'and', left, right: this.parseCompare() };
    }
    return left;
  }

  private parseCompare(): Node {
    const left = this.parsePrimary();

    const inToken = this.peek();
    if (inToken && inToken.type === 'ident' && inToken.value === 'in') {
      this.pos++;
      return { kind: 'compare', op: 'in', left, right: this.parseList() };
    }

    const op = this.matchOp('==', '!=', '<=', '>=', '<', '>');
    if (!op) return left;
    return { kind: 'compare', op, left, right: this.parsePrimary() };
  }

  private parseList(): Node {
    this.eat('punct', '(');
    const items: Node[] = [this.parsePrimary()];
    while (this.peek()?.value === ',') {
      this.pos++;
      items.push(this.parsePrimary());
    }
    this.eat('punct', ')');
    return { kind: 'list', items };
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new ExprError('運算式提前結束');

    if (token.type === 'punct' && token.value === '(') {
      this.pos++;
      const node = this.parseOr();
      this.eat('punct', ')');
      return node;
    }

    if (token.type === 'string') {
      this.pos++;
      return { kind: 'literal', value: token.value };
    }

    if (token.type === 'number') {
      this.pos++;
      return { kind: 'number', value: Number(token.value) };
    }

    if (token.type === 'ident') {
      this.pos++;
      if (token.value === 'true') return { kind: 'bool', value: true };
      if (token.value === 'false') return { kind: 'bool', value: false };
      if (token.value === 'studyIdNum') return { kind: 'studyId' };
      if (token.value === 'batch') return this.parseBatchCall();
      return { kind: 'field', name: token.value };
    }

    throw new ExprError(`未預期的符號：${token.value}`);
  }

  /** batch('slug').cutoff */
  private parseBatchCall(): Node {
    this.eat('punct', '(');
    const slug = this.eat('string').value;
    this.eat('punct', ')');
    this.eat('punct', '.');
    const property = this.eat('ident').value;
    if (property !== 'cutoff') {
      throw new ExprError(`batch() 只支援 .cutoff，收到 .${property}`);
    }
    return { kind: 'batchCutoff', slug };
  }
}

export function parseExpr(source: string): Node {
  return new Parser(tokenize(source)).parse();
}

/* ── evaluation ────────────────────────────────────────────── */

/** An operand resolves to a set of candidate values; empty means unknown. */
type Operand = { values: string[]; unknown: boolean };

function operand(values: string[]): Operand {
  const present = values.filter(v => v !== '');
  return { values: present, unknown: present.length === 0 };
}

function resolve(node: Node, ctx: ExprContext): Operand {
  switch (node.kind) {
    case 'literal':
      return { values: [node.value], unknown: false };
    case 'number':
      return { values: [String(node.value)], unknown: false };
    case 'field':
      return operand(ctx.fieldValues(node.name));
    case 'studyId':
      return { values: [String(ctx.studyIdNum)], unknown: false };
    case 'batchCutoff': {
      const cutoff = ctx.batchCutoff(node.slug);
      // An expression pointing at a batch that does not exist is a config
      // mistake; answering UNKNOWN blocks the work and shows up as such
      // rather than silently marking every patient not-applicable.
      return cutoff === null ? { values: [], unknown: true } : { values: [String(cutoff)], unknown: false };
    }
    case 'list':
      return {
        values: node.items.flatMap(item => resolve(item, ctx).values),
        unknown: false,
      };
    default:
      throw new ExprError(`${node.kind} 不能用於比較`);
  }
}

function compareNumeric(op: string, left: string, right: string): boolean | undefined {
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: return undefined;
  }
}

function evaluateCompare(node: Extract<Node, { kind: 'compare' }>, ctx: ExprContext): Tri {
  const left = resolve(node.left, ctx);
  const right = resolve(node.right, ctx);
  if (left.unknown || right.unknown) return 'unknown';

  // Existential across candidate values: a field read with aggregation 'any'
  // holds one value per repeating row, and matching any of them counts.
  const anyPair = (test: (a: string, b: string) => boolean | undefined): Tri => {
    let sawComparable = false;
    for (const a of left.values) {
      for (const b of right.values) {
        const result = test(a, b);
        if (result === undefined) continue;
        sawComparable = true;
        if (result) return 'true';
      }
    }
    return sawComparable ? 'false' : 'unknown';
  };

  switch (node.op) {
    case '==':
    case 'in':
      return anyPair((a, b) => a === b);
    case '!=':
      // Negation of ==, so "any row matches" stays the thing being negated.
      return anyPair((a, b) => a === b) === 'true' ? 'false' : 'true';
    default:
      return anyPair((a, b) => compareNumeric(node.op, a, b));
  }
}

export function evaluate(node: Node, ctx: ExprContext): Tri {
  switch (node.kind) {
    case 'bool':
      return node.value ? 'true' : 'false';
    case 'compare':
      return evaluateCompare(node, ctx);
    case 'and': {
      const left = evaluate(node.left, ctx);
      if (left === 'false') return 'false';
      const right = evaluate(node.right, ctx);
      if (right === 'false') return 'false';
      return left === 'unknown' || right === 'unknown' ? 'unknown' : 'true';
    }
    case 'or': {
      const left = evaluate(node.left, ctx);
      if (left === 'true') return 'true';
      const right = evaluate(node.right, ctx);
      if (right === 'true') return 'true';
      return left === 'unknown' || right === 'unknown' ? 'unknown' : 'false';
    }
    case 'field': {
      // A bare field is truthy when it holds a non-empty, non-zero value.
      const values = resolve(node, ctx);
      if (values.unknown) return 'unknown';
      return values.values.some(v => v !== '0') ? 'true' : 'false';
    }
    default:
      throw new ExprError(`${node.kind} 不是一個條件`);
  }
}

/** Parse and evaluate in one step. Callers that evaluate repeatedly should cache the AST. */
export function evaluateExpr(source: string, ctx: ExprContext): Tri {
  return evaluate(parseExpr(source), ctx);
}

/**
 * Field names an expression reads. The REDCap export is built from these, so a
 * field missed here would evaluate as empty and silently block or skip work.
 */
export function collectFields(node: Node, into: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case 'field':
      into.add(node.name);
      break;
    case 'list':
      for (const item of node.items) collectFields(item, into);
      break;
    case 'compare':
    case 'and':
    case 'or':
      collectFields(node.left, into);
      collectFields(node.right, into);
      break;
    default:
      break;
  }
  return into;
}
