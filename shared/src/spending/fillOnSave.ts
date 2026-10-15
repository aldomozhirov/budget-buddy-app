/** What `fillOnSave` reads of a category. */
export interface FillCategory {
  /** The envelope an expense of this category goes to; expenses only. */
  defaultEnvelopeId: number | null;
  archived: boolean;
}

/** What `fillOnSave` reads of an envelope. */
export interface FillEnvelope {
  /** The category an expense in this envelope gets. */
  defaultCategoryId: number | null;
  archived: boolean;
}

/** Which field the on-save fill set, and from what (Design 3.5). */
export interface Filled {
  /** The envelope came from the category's default. */
  envelope?: 'category';
  /** The category came from the envelope's default. */
  category?: 'envelope';
}

/** The category and envelope a transaction is saved with. */
export interface FillOnSaveResult {
  categoryId: number | null;
  envelopeId: number | null;
  filled: Filled;
}

/**
 * Fills an empty envelope from the chosen category's default and an empty
 * category from the chosen envelope's default, when a new expense is saved
 * (CAT-5; Design 3.5). Both are read from the submitted values, so they do
 * not chain, and only an active default is used. Income and transfers have
 * no envelope, so nothing is filled for them. The server applies it on
 * create only; the form previews it with the same function.
 * @param category Reads a category by id; undefined when unknown.
 * @param envelope Reads an envelope by id; undefined when unknown.
 */
export function fillOnSave(
  input: {
    kind: 'expense' | 'income' | 'transfer';
    categoryId: number | null;
    envelopeId: number | null;
  },
  category: (id: number) => FillCategory | undefined,
  envelope: (id: number) => FillEnvelope | undefined,
): FillOnSaveResult {
  const result: FillOnSaveResult = {
    categoryId: input.categoryId,
    envelopeId: input.envelopeId,
    filled: {},
  };
  if (input.kind !== 'expense') return result;
  if (input.envelopeId === null && input.categoryId !== null) {
    const fromId = category(input.categoryId)?.defaultEnvelopeId ?? null;
    const target = fromId === null ? undefined : envelope(fromId);
    if (fromId !== null && target && !target.archived) {
      result.envelopeId = fromId;
      result.filled.envelope = 'category';
    }
  }
  if (input.categoryId === null && input.envelopeId !== null) {
    const fromId = envelope(input.envelopeId)?.defaultCategoryId ?? null;
    const target = fromId === null ? undefined : category(fromId);
    if (fromId !== null && target && !target.archived) {
      result.categoryId = fromId;
      result.filled.category = 'envelope';
    }
  }
  return result;
}
