import { merchantKey } from './merchantKey.js';

/** What `matchRule` reads of a rule; the API's rule fits it. */
export interface MatchableRule {
  position: number;
  /** Comma-separated words as typed: "REWE, EDEKA, LIDL". */
  pattern: string;
  categoryId: number;
  envelopeId: number | null;
  /** The rule applies to this account only; null for every account. */
  accountId: number | null;
  categoryArchived: boolean;
  envelopeArchived: boolean;
}

/** The category and envelope a matching rule fills in. */
export interface RuleMatch<Rule extends MatchableRule = MatchableRule> {
  rule: Rule;
  categoryId: number;
  /** Null when the rule names none or its envelope is archived. */
  envelopeId: number | null;
}

/**
 * Splits a rule pattern into its comparable words: trimmed, case-folded,
 * white space collapsed, empty ones dropped.
 */
export function ruleWords(pattern: string): string[] {
  return pattern
    .split(',')
    .map((word) => merchantKey(word))
    .filter((word) => word !== '');
}

/**
 * Finds the rule that labels an expense (CAT-6; O9). A rule matches when the
 * merchant contains any of its words, ignoring case, and the rule is not
 * limited to another account. Rules are tried by `position` and the first
 * match wins; one whose category is archived is skipped, and an archived
 * envelope is left out of the match.
 */
export function matchRule<Rule extends MatchableRule>(
  merchant: string | null | undefined,
  accountId: number | null,
  rules: readonly Rule[],
): RuleMatch<Rule> | null {
  const key = merchantKey(merchant ?? '');
  if (key === '') return null;
  const ordered = [...rules].sort((a, b) => a.position - b.position);
  for (const rule of ordered) {
    if (rule.categoryArchived) continue;
    if (rule.accountId !== null && rule.accountId !== accountId) continue;
    if (!ruleWords(rule.pattern).some((word) => key.includes(word))) continue;
    const envelopeId = rule.envelopeArchived ? null : rule.envelopeId;
    return { rule, categoryId: rule.categoryId, envelopeId };
  }
  return null;
}
