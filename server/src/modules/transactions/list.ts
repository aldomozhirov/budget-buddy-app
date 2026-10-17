import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  addMonths,
  foldText,
  isMinorInRange,
  listTransactionsQuerySchema,
  listTransactionsResponseSchema,
  monthOfDate,
  toMinorString,
  transactionFacetsQuerySchema,
  transactionFacetsResponseSchema,
  type DayTotal,
  type ListedTransaction,
  type ListTransactionsResponse,
  type TransactionFacet,
  type TransactionFacetsResponse,
  type TransactionTotals,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { createValuation, type Valuation } from '../../domain/valuation.js';

/** Rows in a page of the list (Design 5). */
export const transactionPageSize = 50;

/** The filters of the list and the facets (`period` and the rest). */
export interface TransactionFilters {
  period?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  member?: number[] | undefined;
  account?: number[] | undefined;
  category?: Array<number | 'none'> | undefined;
  envelope?: Array<number | 'none'> | undefined;
  kind?: string[] | undefined;
  q?: string | undefined;
}

type Param = string | number | bigint;

/** A SQL condition and the values for its `?` marks, in order. */
interface Clause {
  sql: string;
  params: Param[];
}

/**
 * Registers `GET /api/transactions` and `GET /api/transactions/facets`
 * (TXN-6, UI-TXN-1, UI-TXN-2; Design 5). Both read confirmed transactions
 * only: a draft counts nowhere (requirements 4.6).
 */
export const transactionListRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/transactions', async (request, reply) => {
    const parsed = listTransactionsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidation(reply, parsed.error.issues);
    return listTransactionsResponseSchema.parse(
      listTransactions(database, parsed.data, clock.now().getTime()),
    );
  });

  app.get('/api/transactions/facets', async (request, reply) => {
    const parsed = transactionFacetsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidation(reply, parsed.error.issues);
    const { facet, ...filters } = parsed.data;
    return transactionFacetsResponseSchema.parse(
      transactionFacets(database, facet, filters, clock.now().getTime()),
    );
  });
};

/**
 * One page of the list with the totals of its days and the summary of
 * everything the filters match. `now` is the current instant (UTC epoch
 * milliseconds); "this month" and the like follow the family time zone.
 */
export function listTransactions(
  database: Database.Database,
  query: TransactionFilters & { cursor?: string | undefined },
  now: number,
): ListTransactionsResponse {
  const valuation = createValuation(database);
  const filter = buildFilter(database, valuation, query, valuation.dateOf(now));
  const where = [...filter.where];
  const params = [...filter.params];
  if (query.cursor !== undefined) {
    const [date = '', id = ''] = query.cursor.split(':');
    where.push('(t.date < ? OR (t.date = ? AND t.id < ?))');
    params.push(date, date, BigInt(id));
  }
  const rows = database
    .prepare(
      withJoins(`SELECT t.id, t.kind, t.date, t.account_id AS accountId,
         a.name AS accountName, a.currency, t.amount,
         t.to_account_id AS toAccountId, ta.name AS toAccountName,
         ta.currency AS toCurrency, t.to_amount AS toAmount,
         t.member_id AS memberId, m.name AS memberName, t.merchant, t.note,
         p.category_id AS categoryId, c.name AS categoryName,
         p.envelope_id AS envelopeId, e.name AS envelopeName
       FROM txn t
         JOIN member m ON m.id = t.member_id
         LEFT JOIN category c ON c.id = p.category_id
         LEFT JOIN envelope e ON e.id = p.envelope_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ${transactionPageSize + 1}`),
    )
    .all(...params) as ListRow[];
  const page = rows.slice(0, transactionPageSize);
  const last = page[page.length - 1];

  const groups = dayGroups(database, filter);
  const totals = totalsOf(groups, valuation);
  const dates = new Set(page.map((row) => row.date));
  const days: DayTotal[] = [...dates]
    .sort()
    .reverse()
    .map((date) => ({ date, ...(totals.days.get(date) ?? emptyTotals) }));

  return {
    transactions: page.map(toListed),
    nextCursor:
      rows.length > transactionPageSize && last
        ? `${last.date}:${last.id}`
        : null,
    days,
    summary: {
      count: totals.count,
      ...totals.all,
      currency: valuation.commonCurrency.code,
    },
  };
}

/**
 * What was spent this month in the common currency: the "This month"
 * summary of the list, with no other filter. `spent` is null while a rate
 * is missing (COR-4), since a partial sum would read as the whole.
 */
export function monthSpent(
  database: Database.Database,
  valuation: Valuation,
  today: string,
): string | null {
  const filter = buildFilter(database, valuation, {}, today);
  const groups = dayGroups(database, filter);
  const { all } = totalsOf(groups, valuation);
  return all.incomplete ? null : all.spent;
}

/**
 * The count of each option of one filter, with the other filters applied
 * and the facet's own left out: an option's count is the summary count of
 * the list with only that option picked.
 */
export function transactionFacets(
  database: Database.Database,
  facet: TransactionFacet,
  filters: TransactionFilters,
  now: number,
): TransactionFacetsResponse {
  const valuation = createValuation(database);
  const today = valuation.dateOf(now);
  const filter = buildFilter(database, valuation, filters, today, facet);
  const where = filter.where.join(' AND ');
  const total = Number(
    (
      database
        .prepare(
          withJoins(`SELECT COUNT(*) AS count FROM txn t WHERE ${where}`),
        )
        .get(...filter.params) as { count: bigint }
    ).count,
  );
  const options = (sql: string) =>
    (
      database
        .prepare(
          withJoins(
            `SELECT value, COUNT(*) AS count FROM (${sql}) GROUP BY value
             ORDER BY count DESC, value`,
          ),
        )
        .all(...filter.params) as Array<{ value: string; count: bigint }>
    ).map((row) => ({ value: String(row.value), count: Number(row.count) }));
  const select = (value: string, extra = '1') =>
    `SELECT ${value} AS value FROM txn t WHERE ${where} AND ${extra}`;

  let counted: Array<{ value: string; count: number }>;
  switch (facet) {
    case 'period':
      counted = periodOptions(database, filter, today);
      break;
    case 'member':
      counted = options(select('t.member_id'));
      break;
    case 'account':
      counted = accountOptions(database, filter);
      break;
    case 'category':
      counted = options(
        select(
          `CASE WHEN p.category_id IS NULL THEN 'none'
             ELSE CAST(p.category_id AS TEXT) END`,
          `t.kind != 'transfer'`,
        ),
      );
      break;
    case 'envelope':
      counted = options(
        select(
          `CASE WHEN p.envelope_id IS NULL THEN 'none'
             ELSE CAST(p.envelope_id AS TEXT) END`,
          `t.kind = 'expense'`,
        ),
      );
      break;
    case 'kind':
      counted = options(select(kindExpression));
      break;
  }
  return { facet, total, options: counted };
}

/**
 * Adds the joins a statement refers to after `FROM txn t`: the account
 * (`a`), the account arriving (`ta`) and the first part (`p`). Every
 * transaction has an account, so leaving a join out never drops a row.
 */
function withJoins(sql: string): string {
  const joins = [
    /\ba\./u.test(sql) && 'JOIN account a ON a.id = t.account_id',
    /\bta\./u.test(sql) && 'LEFT JOIN account ta ON ta.id = t.to_account_id',
    /\bp\./u.test(sql) &&
      'LEFT JOIN txn_part p ON p.txn_id = t.id AND p.position = 1',
  ].filter(Boolean);
  return sql.replaceAll('FROM txn t', `FROM txn t ${joins.join(' ')}`);
}

const kindExpression = `CASE WHEN t.kind = 'expense'
  THEN (CASE WHEN t.amount < 0 THEN 'refund' ELSE 'expense' END)
  ELSE t.kind END`;

type ListRow = {
  id: bigint;
  kind: ListedTransaction['kind'];
  date: string;
  accountId: bigint;
  accountName: string;
  currency: string;
  amount: bigint;
  toAccountId: bigint | null;
  toAccountName: string | null;
  toCurrency: string | null;
  toAmount: bigint | null;
  memberId: bigint;
  memberName: string;
  merchant: string | null;
  note: string | null;
  categoryId: bigint | null;
  categoryName: string | null;
  envelopeId: bigint | null;
  envelopeName: string | null;
};

type GroupRow = {
  date: string;
  currency: string;
  spent: bigint;
  income: bigint;
  count: bigint;
};

function toListed(row: ListRow): ListedTransaction {
  const id = (value: bigint | null) => (value === null ? null : Number(value));
  const minor = (value: bigint | null) =>
    value === null ? null : toMinorString(value);
  return {
    id: Number(row.id),
    kind: row.kind,
    date: row.date,
    accountId: Number(row.accountId),
    accountName: row.accountName,
    currency: row.currency,
    amount: toMinorString(row.amount),
    toAccountId: id(row.toAccountId),
    toAccountName: row.toAccountName,
    toCurrency: row.toCurrency,
    toAmount: minor(row.toAmount),
    memberId: Number(row.memberId),
    memberName: row.memberName,
    merchant: row.merchant,
    note: row.note,
    categoryId: id(row.categoryId),
    categoryName: row.categoryName,
    envelopeId: id(row.envelopeId),
    envelopeName: row.envelopeName,
  };
}

const emptyTotals: TransactionTotals = {
  spent: '0',
  income: '0',
  incomplete: false,
};

/**
 * Adds the (day, currency) totals in the common currency. Each is converted
 * at its own day's rate and rounded once (Design 3.11), so the summary is
 * exactly the sum of the day totals (COR-4). A missing rate leaves the
 * amount out and marks the day, and so the whole, incomplete.
 */
function totalsOf(groups: GroupRow[], valuation: Valuation) {
  const common = valuation.commonCurrency.code;
  const days = new Map<string, TransactionTotals>();
  const sums = new Map<
    string,
    { spent: bigint; income: bigint; bad: boolean }
  >();
  let spent = 0n;
  let income = 0n;
  let incomplete = false;
  let count = 0;
  for (const group of groups) {
    count += Number(group.count);
    const convert = (amount: bigint) =>
      group.currency === common
        ? amount
        : valuation.toCommon(amount, group.currency, group.date);
    const groupSpent = convert(group.spent);
    const groupIncome = convert(group.income);
    const day = sums.get(group.date) ?? { spent: 0n, income: 0n, bad: false };
    if (groupSpent === undefined || groupIncome === undefined) {
      day.bad = true;
      incomplete = true;
    }
    day.spent += groupSpent ?? 0n;
    day.income += groupIncome ?? 0n;
    spent += groupSpent ?? 0n;
    income += groupIncome ?? 0n;
    sums.set(group.date, day);
  }
  for (const [date, day] of sums) {
    days.set(date, {
      spent: toMinorString(day.spent),
      income: toMinorString(day.income),
      incomplete: day.bad,
    });
  }
  return {
    count,
    days,
    all: {
      spent: toMinorString(spent),
      income: toMinorString(income),
      incomplete,
    },
  };
}

/** The (day, currency) groups the filters match, for the totals. */
function dayGroups(database: Database.Database, filter: Filter): GroupRow[] {
  return database
    .prepare(
      withJoins(`SELECT t.date AS date, a.currency AS currency,
         SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END) AS spent,
         SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END) AS income,
         COUNT(*) AS count
       FROM txn t
       WHERE ${filter.where.join(' AND ')}
       GROUP BY t.date, a.currency`),
    )
    .all(...filter.params) as GroupRow[];
}

/** The `WHERE` conditions of the filters, ANDed, and their values. */
interface Filter {
  where: string[];
  params: Param[];
}

function buildFilter(
  database: Database.Database,
  valuation: Valuation,
  filters: TransactionFilters,
  today: string,
  omit?: TransactionFacet,
): Filter {
  const clauses: Clause[] = [{ sql: `t.status = 'confirmed'`, params: [] }];
  const add = (clause: Clause | null) => {
    if (clause) clauses.push(clause);
  };
  if (omit !== 'period') add(periodClause(filters, today));
  if (omit !== 'member') add(inList('t.member_id', filters.member));
  if (omit !== 'account') add(accountClause(filters.account));
  if (omit !== 'category') {
    add(withNone(filters.category, 'p.category_id', `t.kind != 'transfer'`));
  }
  if (omit !== 'envelope') {
    add(withNone(filters.envelope, 'p.envelope_id', `t.kind = 'expense'`));
  }
  if (omit !== 'kind') add(kindClause(filters.kind));
  add(searchClause(database, valuation, filters.q));
  return {
    where: clauses.map((clause) => `(${clause.sql})`),
    params: clauses.flatMap((clause) => clause.params),
  };
}

function lastDayOf(month: string): string {
  const [year = 0, number = 0] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/**
 * The first and last day of a period, or null for all time. "Last 3 months"
 * is this month and the two before it.
 */
function periodRange(
  filters: Pick<TransactionFilters, 'period' | 'from' | 'to'>,
  today: string,
): [string, string] | null {
  const month = monthOfDate(today);
  switch (filters.period ?? 'this_month') {
    case 'this_month':
      return [`${month}-01`, lastDayOf(month)];
    case 'last_month': {
      const last = addMonths(month, -1);
      return [`${last}-01`, lastDayOf(last)];
    }
    case 'last_3_months':
      return [`${addMonths(month, -2)}-01`, lastDayOf(month)];
    case 'this_year':
      return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    case 'custom':
      return [filters.from ?? '0000-01-01', filters.to ?? '9999-12-31'];
    default:
      return null;
  }
}

const countedPeriods = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
  'all',
] as const;

function periodClause(
  filters: TransactionFilters,
  today: string,
): Clause | null {
  const range = periodRange(filters, today);
  return range ? { sql: 't.date >= ? AND t.date <= ?', params: range } : null;
}

/** Counts each preset period, with the other filters applied. */
function periodOptions(
  database: Database.Database,
  filter: Filter,
  today: string,
) {
  const ranges = countedPeriods.map((period) => periodRange({ period }, today));
  const row = database
    .prepare(
      withJoins(`SELECT ${ranges
        .map((range) =>
          range ? 'COALESCE(SUM(t.date BETWEEN ? AND ?), 0)' : 'COUNT(*)',
        )
        .join(', ')}
       FROM txn t WHERE ${filter.where.join(' AND ')}`),
    )
    .raw()
    .get(
      ...ranges.flatMap((range) => range ?? []),
      ...filter.params,
    ) as bigint[];
  return countedPeriods
    .map((value, index) => ({
      value: String(value),
      count: Number(row[index]),
    }))
    .filter((option) => option.count > 0);
}

/** Counts each account; a transfer counts for both of its accounts. */
function accountOptions(database: Database.Database, filter: Filter) {
  const where = filter.where.join(' AND ');
  const rows = database
    .prepare(
      withJoins(`SELECT value, COUNT(*) AS count FROM (
         SELECT t.account_id AS value FROM txn t WHERE ${where}
         UNION ALL
         SELECT t.to_account_id FROM txn t
           WHERE ${where} AND t.to_account_id IS NOT NULL
       ) GROUP BY value ORDER BY count DESC, value`),
    )
    .all(...filter.params, ...filter.params) as Array<{
    value: bigint;
    count: bigint;
  }>;
  return rows.map((row) => ({
    value: String(row.value),
    count: Number(row.count),
  }));
}

function inList(column: string, values: number[] | undefined): Clause | null {
  if (values === undefined || values.length === 0) return null;
  return {
    sql: `${column} IN (${values.map(() => '?').join(', ')})`,
    params: values,
  };
}

function accountClause(values: number[] | undefined): Clause | null {
  if (values === undefined || values.length === 0) return null;
  const marks = values.map(() => '?').join(', ');
  return {
    sql: `t.account_id IN (${marks}) OR t.to_account_id IN (${marks})`,
    params: [...values, ...values],
  };
}

/**
 * Ids and `none` for the category or envelope. `none` matches the
 * transactions that can have one and do not: `owner` names those.
 */
function withNone(
  values: Array<number | 'none'> | undefined,
  column: string,
  owner: string,
): Clause | null {
  if (values === undefined || values.length === 0) return null;
  const ids = values.filter((value): value is number => value !== 'none');
  const parts: string[] = [];
  if (ids.length > 0) {
    parts.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
  }
  if (ids.length < values.length) {
    parts.push(`(${column} IS NULL AND ${owner})`);
  }
  return { sql: parts.join(' OR '), params: ids };
}

function kindClause(values: string[] | undefined): Clause | null {
  if (values === undefined || values.length === 0) return null;
  const sql: Record<string, string> = {
    expense: `(t.kind = 'expense' AND t.amount > 0)`,
    refund: `(t.kind = 'expense' AND t.amount < 0)`,
    income: `t.kind = 'income'`,
    transfer: `t.kind = 'transfer'`,
  };
  return {
    sql: values.map((value) => sql[value] ?? '0').join(' OR '),
    params: [],
  };
}

const numberPattern = /^(\d{1,19})(?:[.,](\d{1,19}))?$/u;

/**
 * Every word of the search must match (Design 5): a word matches the
 * merchant, note, category, envelope, account (either side of a transfer)
 * or payer name as a case-folded part of it, or, when it is a number, an
 * amount.
 */
function searchClause(
  database: Database.Database,
  valuation: Valuation,
  text: string | undefined,
): Clause | null {
  const words = (text ?? '').split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0) return null;
  const names = (table: string) =>
    (
      database.prepare(`SELECT id, name FROM ${table}`).all() as Array<{
        id: bigint;
        name: string;
      }>
    ).map((row) => ({ id: Number(row.id), name: foldText(row.name) }));
  const tables = {
    category: names('category'),
    envelope: names('envelope'),
    account: names('account'),
    member: names('member'),
  };
  const decimals = new Map<number, string[]>();
  for (const row of database
    .prepare('SELECT DISTINCT currency FROM account')
    .all() as Array<{ currency: string }>) {
    const places = valuation.currency(row.currency).decimals;
    decimals.set(places, [...(decimals.get(places) ?? []), row.currency]);
  }

  const groups = words.map((word): Clause => {
    const folded = foldText(word);
    const parts: Clause[] = [
      { sql: 'instr(t.merchant_key, ?) > 0', params: [folded] },
      {
        sql: `instr(unicode_casefold(COALESCE(t.note, '')), ?) > 0`,
        params: [folded],
      },
    ];
    const match = (rows: Array<{ id: number; name: string }>) =>
      rows.filter((row) => row.name.includes(folded)).map((row) => row.id);
    const category = inList('p.category_id', match(tables.category));
    const envelope = inList('p.envelope_id', match(tables.envelope));
    const account = accountClause(match(tables.account));
    const member = inList('t.member_id', match(tables.member));
    for (const part of [category, envelope, account, member]) {
      if (part) parts.push(part);
    }
    const amount = amountClause(word, decimals);
    if (amount) parts.push(amount);
    return {
      sql: parts.map((part) => `(${part.sql})`).join(' OR '),
      params: parts.flatMap((part) => part.params),
    };
  });
  return {
    sql: groups.map((group) => `(${group.sql})`).join(' AND '),
    params: groups.flatMap((group) => group.params),
  };
}

/**
 * The amount rule for a number word: `64.2` and `64.20` match 64.20 and `64`
 * matches 64.00 to 64.99, whatever the sign, in the currency's own places.
 * An amount is compared where its own currency has the places the word
 * uses; a currency with fewer places than typed matches nothing.
 */
function amountClause(
  word: string,
  decimals: Map<number, string[]>,
): Clause | null {
  const match = numberPattern.exec(word);
  if (!match) return null;
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').replace(/0+$/u, '');
  const typed = match[2] !== undefined;
  const parts: Clause[] = [];
  for (const [places, currencies] of decimals) {
    if (fraction.length > places) continue;
    const unit = 10n ** BigInt(places);
    const low =
      whole * unit + (typed ? BigInt(fraction.padEnd(places, '0') || '0') : 0n);
    const high = typed ? low : low + unit - 1n;
    if (!isMinorInRange(high)) continue;
    const marks = currencies.map(() => '?').join(', ');
    parts.push(
      {
        sql: `a.currency IN (${marks}) AND
          (t.amount BETWEEN ? AND ? OR t.amount BETWEEN ? AND ?)`,
        params: [...currencies, low, high, -high, -low],
      },
      {
        sql: `ta.currency IN (${marks}) AND t.to_amount BETWEEN ? AND ?`,
        params: [...currencies, low, high],
      },
    );
  }
  if (parts.length === 0) return null;
  return {
    sql: parts.map((part) => `(${part.sql})`).join(' OR '),
    params: parts.flatMap((part) => part.params),
  };
}

function sendValidation(
  reply: FastifyReply,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    fields[field] ??= issue.message;
  }
  return reply.code(400).send({
    error: { code: 'validation', message: 'Check the filters.', fields },
  });
}
