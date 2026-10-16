import { foldText } from './merchantKey.js';

/** What the account chips read of an account. */
export interface ChipAccount {
  id: number;
  name: string;
  ownerMemberId: number | null;
  ownerName: string | null;
  type: string;
  currency: string;
  symbol: string;
}

/** An account chip on the Add form. */
export interface AccountChip<Account extends ChipAccount = ChipAccount> {
  account: Account;
  /** "Max · DKB", "Cash €": see `accountChipLabels`. */
  label: string;
}

/** How many account chips the Add form shows before "All…" (Design 3.7). */
export const ACCOUNT_CHIP_COUNT = 5;

/**
 * Picks the accounts on the chip row (Design 3.7): the first five of the
 * order, with the profile's own cash account among them; when it is not in
 * the first five it replaces the fifth.
 * @param ordered Active accounts in the profile's order, default first.
 */
export function pickAccountChips<Account extends ChipAccount>(
  ordered: readonly Account[],
  profileId: number,
  count: number = ACCOUNT_CHIP_COUNT,
): Account[] {
  const chips = ordered.slice(0, count);
  const cash = ordered.find(
    (account) => account.type === 'cash' && account.ownerMemberId === profileId,
  );
  if (cash && !chips.includes(cash) && chips.length > 0) {
    chips[chips.length - 1] = cash;
  }
  return chips;
}

/**
 * Labels the chips of one row (Design 3.7): the account's name, the owner's
 * name in front for another profile's account ("Max · DKB"), and the
 * currency symbol after it when the currency is not the common currency or
 * when two chips would read the same ("Cash €", "Cash $").
 */
export function accountChipLabels<Account extends ChipAccount>(
  accounts: readonly Account[],
  profileId: number,
  commonCurrency: string,
): AccountChip<Account>[] {
  const bases = accounts.map((account) =>
    account.ownerMemberId !== null &&
    account.ownerMemberId !== profileId &&
    account.ownerName !== null
      ? `${account.ownerName} · ${account.name}`
      : account.name,
  );
  const seen = new Map<string, number>();
  for (const base of bases) {
    const key = foldText(base);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return accounts.map((account, index) => {
    const base = bases[index] ?? account.name;
    const clash = (seen.get(foldText(base)) ?? 0) > 1;
    const symbol = account.currency !== commonCurrency || clash;
    return { account, label: symbol ? `${base} ${account.symbol}` : base };
  });
}
