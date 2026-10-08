import Decimal from 'decimal.js';
import type { Currency } from './currency.js';
import { isMinorInRange } from './minor.js';
import { roundHalfAwayFromZero } from './rounding.js';

/**
 * Outcome of evaluating a typed amount: minor units, or a short user-facing
 * reason such as `'Division by zero'`.
 */
export type ExpressionResult = { readonly ok: true; readonly value: bigint } | { readonly ok: false; readonly reason: string };

/** Decimal context for expressions: 100 significant digits. */
const ExpressionDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP });

/** Error whose message is shown to the user as the failure reason. */
class ExpressionError extends Error {}

/**
 * Splits an expression into number, operator and bracket tokens, accepting
 * typographic − × ÷ and reading commas as decimal points.
 * @throws {ExpressionError} on an invalid character or malformed number.
 */
function tokenize(expression: string): string[] {
  const input = expression.replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/').replaceAll(',', '.');
  const tokens: string[] = [];
  for (let index = 0; index < input.length;) {
    const character = input[index];
    if (character === undefined) break;
    if (/\s/.test(character)) { index += 1; continue; }
    if (/[0-9.]/.test(character)) {
      const start = index;
      let dots = 0;
      while (index < input.length && /[0-9.]/.test(input[index] ?? '')) {
        if (input[index] === '.') dots += 1;
        index += 1;
      }
      const literal = input.slice(start, index);
      if (dots > 1 || literal === '.') throw new ExpressionError('Invalid number');
      tokens.push(literal);
      continue;
    }
    if ('+-*/()%'.includes(character)) { tokens.push(character); index += 1; continue; }
    throw new ExpressionError('Invalid character');
  }
  return tokens;
}

/**
 * Evaluates tokens with brackets binding tightest, then postfix `%`
 * (divide by 100), then `*` `/`, then `+` `-`. Unary minus is allowed only
 * at the start or straight after `(`.
 * @throws {ExpressionError} on a syntax error or division by zero.
 */
function parseTokens(tokens: readonly string[]): Decimal {
  let position = 0;
  const current = (): string | undefined => tokens[position];
  const consume = (): string | undefined => tokens[position++];

  function primary(allowUnary: boolean): Decimal {
    if (current() === '-' && allowUnary) {
      consume();
      return primary(false).negated();
    }
    if (current() === '(') {
      consume();
      const value = additive();
      if (consume() !== ')') throw new ExpressionError('Unbalanced brackets');
      return value;
    }
    const token = consume();
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new ExpressionError('Expected a number');
    return new ExpressionDecimal(token);
  }

  function postfix(allowUnary: boolean): Decimal {
    let value = primary(allowUnary);
    while (current() === '%') { consume(); value = value.div(100); }
    return value;
  }

  function multiplicative(): Decimal {
    let value = postfix(position === 0 || tokens[position - 1] === '(');
    while (current() === '*' || current() === '/') {
      const operator = consume();
      const right = postfix(false);
      if (operator === '/' && right.isZero()) throw new ExpressionError('Division by zero');
      value = operator === '*' ? value.mul(right) : value.div(right);
    }
    return value;
  }

  function additive(): Decimal {
    let value = multiplicative();
    while (current() === '+' || current() === '-') {
      const operator = consume();
      const right = multiplicative();
      value = operator === '+' ? value.add(right) : value.sub(right);
    }
    return value;
  }

  if (tokens.length === 0) throw new ExpressionError('Enter an amount');
  const result = additive();
  if (position !== tokens.length) {
    if (current() === ')') throw new ExpressionError('Unbalanced brackets');
    throw new ExpressionError('Unexpected input');
  }
  return result;
}

/**
 * Rounds a value to the currency's minor units, half away from zero.
 * @throws {ExpressionError} if the result doesn't fit a 64-bit integer.
 */
function minorResult(value: Decimal, currency: Currency): bigint {
  const minor = roundHalfAwayFromZero(value, currency.decimals);
  if (!isMinorInRange(minor)) throw new ExpressionError('Amount is too large');
  return minor;
}

/**
 * Evaluates an amount typed as arithmetic into minor units of `currency`.
 * Supports `+ - * /` (or `− × ÷`), brackets and postfix `%`, which divides
 * the value before it by 100. Commas are decimal points, not separators.
 * Unary minus is allowed only at the start or straight after `(`. Uses
 * 100-digit decimals and rounds once, half away from zero. Never throws.
 * @example
 * evaluateExpression('200 + 10%', getCurrency('EUR')!);
 * // { ok: true, value: 20010n }
 */
export function evaluateExpression(expression: string, currency: Currency): ExpressionResult {
  try {
    const result = parseTokens(tokenize(expression));
    if (!result.isFinite()) return { ok: false, reason: 'Amount is too large' };
    return { ok: true, value: minorResult(result, currency) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Invalid expression' };
  }
}

/**
 * Returns a preview value for an expression still being typed: trailing
 * operators and empty brackets are dropped and open brackets closed before
 * evaluating.
 * Returns `undefined` when the expression neither ends in an operator nor
 * has unclosed brackets (use `evaluateExpression`), or cannot be evaluated.
 */
export function lastCompleteValue(expression: string, currency: Currency): bigint | undefined {
  let tokens: string[];
  try { tokens = tokenize(expression); } catch { return undefined; }
  if (tokens.length === 0) return undefined;
  const trailingOperator = ['+', '-', '*', '/'].includes(tokens.at(-1) ?? '');
  let openBrackets = 0;
  for (const token of tokens) {
    if (token === '(') openBrackets += 1;
    if (token === ')') openBrackets -= 1;
  }
  if (!trailingOperator && openBrackets <= 0) return undefined;
  // Drop trailing operators and just-opened brackets: `1 + (` previews as 1.
  while (['+', '-', '*', '/', '('].includes(tokens.at(-1) ?? '')) {
    if (tokens.pop() === '(') openBrackets -= 1;
  }
  while (openBrackets > 0) {
    tokens.push(')');
    openBrackets -= 1;
  }
  try { return minorResult(parseTokens(tokens), currency); } catch { return undefined; }
}
