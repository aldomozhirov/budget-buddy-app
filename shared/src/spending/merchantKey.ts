import { caseFold } from 'unicode-case-folding';

/**
 * Folds text for comparison the way the database's `unicode_casefold`
 * function does, so a name compares equal on the phone and on the server.
 */
export function foldText(value: string): string {
  return caseFold(value.normalize('NFKC')).normalize('NFKC');
}

/**
 * The key under which a merchant is counted and suggested (Design 3.6): the
 * text trimmed, inner white space collapsed to one space and case-folded.
 * Empty when the merchant is blank.
 *
 * @example merchantKey('  REWE   City ') // 'rewe city'
 */
export function merchantKey(merchant: string): string {
  return foldText(merchant.trim().replace(/\s+/gu, ' '));
}
