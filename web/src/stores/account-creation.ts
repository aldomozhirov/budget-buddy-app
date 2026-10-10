let accountAddedNoticeId: number | null = null;

/** Marks the account that should show the one-time post-creation notice. */
export function markAccountCreated(accountId: number): void {
  accountAddedNoticeId = accountId;
}

/** Consumes the post-creation notice when its account page is first entered. */
export function consumeAccountAddedNotice(accountId: number): boolean {
  if (accountAddedNoticeId !== accountId) return false;
  accountAddedNoticeId = null;
  return true;
}
