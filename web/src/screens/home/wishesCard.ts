import type { HomeResponse, HomeWish } from '@budget-buddy/shared';

/** The cards of Home's carousel, by the name that is remembered (UI-HOME-10). */
export type HomeCardKey = 'envelopes' | 'wishes';

/** One open wish's row on the Wishes card. */
export interface WishRowLines {
  wish: HomeWish;
  /** The line at the right: "€120.00 of €350.00", or "34% spent" hidden. */
  text: string;
  /** Whole percent of the wish spent, 0 to 100, for the bar. */
  share: number;
  /** More is spent than the wish holds. */
  over: boolean;
}

/** What the Wishes card says; amounts only while `visible`. */
export interface WishesCardLines {
  /** The large figure: the month's spending on wishes, or its dots. */
  figure: string;
  /** The words beside it: "spent of €830.00 wished", "spent on wishes". */
  caption: string;
  rows: WishRowLines[];
  /** The last row: "2 open this month · see all wishes", "Plan a wish". */
  footer: string;
  /** The card has no open wish: "No wishes this month". */
  empty: boolean;
}

/** Formats an amount in a currency; hidden amounts never reach it. */
interface Money {
  money(minor: string, code: string): string;
  masked(code: string): string;
}

/** Whole percent spent, rounded down, 100 at most; 0 for a zero amount. */
function shareOf(wish: HomeWish): number {
  const amount = BigInt(wish.amount);
  if (amount <= 0n) return 0;
  const share = (BigInt(wish.spent) * 100n) / amount;
  return Number(share > 100n ? 100n : share);
}

/**
 * Builds the Wishes card's lines (UI-HOME-10). Hidden, an amount is never
 * shown: the figure is the currency's dots, and a row shows the share spent.
 * The dots have four, as the design draws them.
 */
export function wishesCardLines(
  wishes: HomeResponse['wishes'],
  visible: boolean,
  common: string,
  formatter: Money,
): WishesCardLines {
  const rows = wishes.items.map((wish): WishRowLines => {
    const spent = BigInt(wish.spent);
    const over = spent > BigInt(wish.amount);
    const share = shareOf(wish);
    let text: string;
    if (spent === 0n) text = 'Nothing spent yet';
    else if (visible) {
      text = `${formatter.money(wish.spent, wish.currency)} of ${formatter.money(
        wish.amount,
        wish.currency,
      )}`;
    } else text = over ? 'Over budget' : `${share}% spent`;
    return { wish, text, share, over };
  });
  const open = wishes.open;
  const empty = open === 0;
  let figure: string;
  let caption: string;
  if (visible) {
    figure =
      wishes.spent === null
        ? 'Rate missing'
        : formatter.money(wishes.spent, common);
    caption =
      wishes.wished === null
        ? 'spent on wishes'
        : `spent of ${formatter.money(wishes.wished, common)} wished`;
    // A currency without a rate is left out of both totals.
    if (wishes.incomplete) caption += ' · Rate missing';
  } else {
    figure = formatter.masked(common).replace(/ •$/u, '');
    caption = 'spent on wishes';
  }
  return {
    figure,
    caption,
    rows,
    footer: empty ? 'Plan a wish' : `${open} open this month · see all wishes`,
    empty,
  };
}
