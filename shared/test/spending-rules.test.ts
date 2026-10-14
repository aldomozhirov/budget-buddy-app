import { describe, expect, it } from 'vitest';
import {
  createRuleRequestSchema,
  foldText,
  matchRule,
  merchantKey,
  ruleWords,
  type MatchableRule,
} from '../src/index.js';

let nextPosition = 1;

/** A rule on any account with the given pattern, category 10. */
function rule(
  pattern: string,
  overrides: Partial<MatchableRule> = {},
): MatchableRule {
  return {
    position: nextPosition++,
    pattern,
    categoryId: 10,
    envelopeId: null,
    accountId: null,
    categoryArchived: false,
    envelopeArchived: false,
    ...overrides,
  };
}

describe('merchantKey', () => {
  it('trims, collapses white space and folds case', () => {
    expect(merchantKey('  REWE   City ')).toBe('rewe city');
    expect(merchantKey('Bäckerei\tMÜLLER')).toBe('bäckerei müller');
    expect(merchantKey('Straße')).toBe(foldText('STRASSE'));
    expect(merchantKey('   ')).toBe('');
  });
});

describe('ruleWords', () => {
  it('splits on commas, trims, folds and drops empty words', () => {
    expect(ruleWords('REWE, EDEKA,, lidl ,  ')).toEqual([
      'rewe',
      'edeka',
      'lidl',
    ]);
    expect(ruleWords(' , ,')).toEqual([]);
  });
});

describe('matchRule', () => {
  it('matches case-insensitively, also with umlauts', () => {
    nextPosition = 1;
    expect(matchRule('REWE City', 1, [rule('rewe')])?.categoryId).toBe(10);
    expect(
      matchRule('BÄCKEREI MÜLLER', 1, [rule('Bäckerei')])?.categoryId,
    ).toBe(10);
    expect(matchRule('bäckerei müller', 1, [rule('BÄCKEREI')])).not.toBeNull();
    expect(matchRule('Lidl', 1, [rule('rewe')])).toBeNull();
  });

  it('matches when the merchant contains any of several words', () => {
    nextPosition = 1;
    const rules = [rule('REWE, EDEKA, LIDL, ALDI')];
    expect(matchRule('Lidl Süd', 1, rules)).not.toBeNull();
    expect(matchRule('ALDI', 1, rules)).not.toBeNull();
    expect(matchRule('Penny', 1, rules)).toBeNull();
  });

  it('ignores extra white space in the merchant and in the words', () => {
    nextPosition = 1;
    expect(matchRule('REWE   CITY', 1, [rule('rewe  city')])).not.toBeNull();
  });

  it('never matches without a merchant or a usable word', () => {
    nextPosition = 1;
    expect(matchRule(null, 1, [rule('rewe')])).toBeNull();
    expect(matchRule('  ', 1, [rule('rewe')])).toBeNull();
    expect(matchRule('REWE', 1, [rule(' , ')])).toBeNull();
  });

  it('applies a rule limited to an account to that account only', () => {
    nextPosition = 1;
    const rules = [rule('REWE', { accountId: 7 })];
    expect(matchRule('REWE', 7, rules)).not.toBeNull();
    expect(matchRule('REWE', 8, rules)).toBeNull();
    expect(matchRule('REWE', null, rules)).toBeNull();
    expect(matchRule('REWE', 8, [...rules, rule('REWE')])?.rule.accountId).toBe(
      null,
    );
  });

  it('lets the first rule by position win, whatever the array order', () => {
    nextPosition = 1;
    const first = rule('REWE', { categoryId: 1 });
    const second = rule('REWE', { categoryId: 2 });
    expect(matchRule('REWE', 1, [first, second])?.categoryId).toBe(1);
    expect(matchRule('REWE', 1, [second, first])?.categoryId).toBe(1);
  });

  it('skips a rule whose category is archived', () => {
    nextPosition = 1;
    const rules = [
      rule('REWE', { categoryId: 1, categoryArchived: true }),
      rule('REWE', { categoryId: 2 }),
    ];
    expect(matchRule('REWE', 1, rules)?.categoryId).toBe(2);
    expect(matchRule('REWE', 1, [rules[0]!])).toBeNull();
  });

  it('leaves an archived envelope out of the match', () => {
    nextPosition = 1;
    const archived = rule('REWE', { envelopeId: 5, envelopeArchived: true });
    const active = rule('REWE', { envelopeId: 5 });
    expect(matchRule('REWE', 1, [archived])).toMatchObject({
      categoryId: 10,
      envelopeId: null,
    });
    expect(matchRule('REWE', 1, [active])?.envelopeId).toBe(5);
  });
});

describe('rule pattern schema', () => {
  it('refuses a pattern without a word', () => {
    const base = { categoryId: 1 };
    expect(
      createRuleRequestSchema.safeParse({ ...base, pattern: ' , ' }).success,
    ).toBe(false);
    expect(
      createRuleRequestSchema.safeParse({ ...base, pattern: '  ' }).success,
    ).toBe(false);
    expect(
      createRuleRequestSchema.safeParse({ ...base, pattern: 'REWE' }).success,
    ).toBe(true);
  });
});
