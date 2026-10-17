import type { TransactionFilters } from './transactionsFormat.js';

/** What the Transactions list was showing when a row was opened. */
export interface ListState {
  tab: 'all' | 'needs-category';
  filters: TransactionFilters;
}

let remembered: { path: string; state: ListState } | null = null;

/**
 * Remembers the list's tab and filters as it is left for a transaction, so
 * Back finds it as it was (the address does not follow the filters).
 */
export function rememberList(path: string, state: ListState): void {
  remembered = { path, state: { tab: state.tab, filters: state.filters } };
}

/** Takes what `rememberList` kept for this address, once. */
export function recallList(path: string): ListState | null {
  const found = remembered?.path === path ? remembered.state : null;
  remembered = null;
  return found;
}
